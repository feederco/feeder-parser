(function() {
	var parseTo$, parseRoot;
	var entities, URI, FIXES;

	if (typeof require !== "undefined") {
		entities = require('entities');

		URI = require('./uri');

		FIXES = require('./fixes');

		parseTo$ = function(text) {
			return require('cheerio').load(text, {
				xmlMode: true,
				lowerCaseTags: true
			});
		}

		parseRoot = function(text, $) {
			return $.root().children().first();
		}
	} else {
		URI = this.URI;
		FIXES = this.FIXES;

		parseTo$ = function(text) {
			return jQuery;
		}

		parseRoot = function(text, $) {
			var xml = new DOMParser().parseFromString(text, 'text/xml');
			var root = xml.documentElement;

			// // If parsing as XML failed, try and parse as HTML, because HTML is so lovely
			// if (root && root.querySelector('parsererror') ) {
			// 	// Try to parse as HTML instead
			// 	// TODO: FIXME: Strip <script>-tags and <img>-tags
			// 	var placeholder = document.createElement('parse-xml');
			// 	placeholder.innerHTML = text;
			//
			// 	root = placeholder.firstElementChild;
			// }

			if (!root) {
				return false;
			}
			return jQuery(root);
		}

		entities = {
			decode: function(text) {
				return jQuery("<textarea />")
					.html(text)
					.text()
					// Attempt to strip out HTML tags
					.replace(/<(?:.|\n)*?>/gm, '');
			}
		}
	}

	function RSSParser(feed) {
		this.feed = feed;
		this.path = feed.path;

		this.maxPostsPerFeed = 250;

		this.error = false;
		this.posts = [];
		this.data = {};

		this.fixes = FIXES[this.path] || {};

		this.rootElement = false;
	};

	RSSParser.prototype.setResult = function(text, callback) {
		callback = typeof callback === 'function' ? callback : function() {};

		if (!text) {
			this.error = true;
			callback();
			return;
		}

		text = RSSParser.trimChars(text);

		try {
			this.$ = parseTo$(text);
			this.rootElement = parseRoot(text, this.$);
		} catch (e) {
		 	this.rootElement = false;
		}

		if (! this.rootElement) {
			this.error = true;
			this.errorMessage = "no root element";
			callback();
			return;
		}

		callback();
	};

	RSSParser.prototype.parse = function(callback) {
		callback = typeof callback === 'function' ? callback : function() {};

		try {
			this.doParse(function() {});

			var min;
			var max;

			this.posts.forEach(function(post) {
				if (post.published_from_feed) {
					if (typeof min === "undefined") {
						min = post.published_from_feed;
					}
					if (typeof max === "undefined") {
						max = post.published_from_feed;
					}
					min = Math.min(post.published_from_feed, min);
					max = Math.max(post.published_from_feed, max);
				}
			});

			var diff = max - min;
			// 100 milliseconds
			allSamePublished = isNaN(diff) || (diff < 100);

			if (allSamePublished) {
				this.feedHasBrokenPublishedDate();
			}

			callback(this);
		} catch(e) {
			this.error = true;
			this.errorMessage = "could not parse: " + e.message;
			this.errorException = e;
			callback(this);
		}
	};

	RSSParser.prototype.doParse = function(callback) {
		this.currentCallback = callback;
		var rootElement = this.rootElement;

		if (this.error) {
			this.currentCallback(this);
			return;
		}

		// Test for RSS
		var type = false;

		if (this.rootElement.is("rss, rdf, rdf\\:rdf"))
			type = 'rss';
		else if (this.rootElement.is("feed"))
			type = 'atom';

		if (! type) {
			this.error = true;
			this.errorMessage = "not compatible " + ((this.rootElement && this.rootElement[0]) || {}).tagName;
			this.currentCallback(this);
			return;
		}

		try {
			switch ( type ) {
				case 'rss':
					this.parseRSSResponse(rootElement);
					break;

				case 'atom':
					this.parseAtomResponse(rootElement);
					break;
			}

			this.feed.title = this.data.title;
			this.feed.link = this.data.link;
			this.currentCallback(this);
		} catch (e) {
			this.error = true;
			this.errorMessage = "could not parse " + type + ": " + e.message;
			this.errorException = e;
			this.currentCallback(this);
		}
	};

	RSSParser.prototype.parseRSSResponse = function(rootElement) {
    var link = this.parseLink(rootElement);

		if (! link) {
			link = this.path;
		}

		this.data.link = link;
		this.path = link;

		this.data.favicon = 'chrome://favicon/' + this.getDomain(this.data.link);

		var titleEl = rootElement.find('title').first();
		this.data.title = RSSParser.trimChars(titleEl.text());

		var posts = rootElement.find('item');
		for ( var i = 0, post; (post = posts[i]); i++ ) {
			post = this.$(post);

			var titleElement = post.find('title').first();
			var linkElements = post.find('link, rss\\:link, guid[isPermaLink]:not([isPermaLink="false"])');
			var guidElement = this.getGuid(post);
			if (!linkElements.length) {
				if (guidElement.text().match(/^http:\/\//))
					linkElements = guidElement;
			}

			if (! titleElement.length || ! linkElements.length)
				if (!guidElement.length)
					continue;

			// Fulhax for itunes feeds
			var enclosureElement = post.find('enclosure');
			var podcastURL = enclosureElement.length ? enclosureElement.attr('url') : false;
			var fallbackElement = podcastURL ? podcastURL : false;
			// end fulhax

			var link;
			if (linkElements.length)
				link = this.parsePostLink(linkElements);
			else
				link = fallbackElement;
			if (! link)
				continue;

			var descriptionElement = post.find('content,content\\:encoded,description,rss\\:description');
			var summary = descriptionElement.text();

			this.foundPost({
				title: titleElement.text() || link,
				link: this.resolveURL(link),
				published_from_feed: this.getDate(post),
				guid: guidElement.text(),
				summary: summary,
				index: i
			});
		}
	};

	RSSParser.prototype.parseAtomResponse = function(rootElement) {
		var titleEl = rootElement.find('title').first();

		this.data.link = this.parseLink(rootElement);
		this.data.title = RSSParser.trimChars(titleEl.length ? titleEl.text() : this.data.link);
		this.data.favicon = 'chrome://favicon/' + this.getDomain(this.data.link);

		this.path = this.data.link;

		var posts = rootElement.find('entry');
		for ( var i = 0, post; (post = posts[i]); i++ ) {
			post = this.$(post);

			var titleElement = post.find('title').first();
			var linkElements = post.find('link');
			var guidElement = this.getGuid(post);

			if (! titleElement.length || ! linkElements.length)
				continue;

			var link = this.parsePostLink(linkElements);

			var descriptionElement = post.find('content,content\\:encoded,description');
			var summary = descriptionElement.text();

			this.foundPost({
				title: titleElement.text() || link,
				link: this.resolveURL(link),
				published_from_feed: this.getDate(post),
				guid: guidElement.text() || '',
				summary: summary,
				index: i
			});
		}
	};

	RSSParser.prototype.parseLink = function(rootElement) {
		var links = rootElement.find('link');
		var $ = this.$;

		// Find link
		links = links.filter(function(index, l) {
			return ! RSSParser.matchTag($(l), 'entry');
		}).toArray();

    var link;
		var links = [].slice.call(rootElement.find('link')).filter(function(el) {
			return el.parent != rootElement[0];
		});

    var chosenLink = false;

		for ( var i = 0, l; l = links[i]; i++ ) {
			l = this.$(l);
      if (l.attr("rel") && l.attr("rel") !== "alternate") {
        continue;
      }
			link = RSSParser.cleanData(l.text());
      if (!link) {
        link = RSSParser.cleanData(l.attr("href"));
      }
      if (link) {
        chosenLink = links[i];
        break;
      }
		}

		if (!link)
			return "";

		var href = RSSParser.trimChars(link);
		return RSSParser.resolveFrom(chosenLink, href);
	};

	RSSParser.prototype.resolveURL = function(link) {
		if (/http?:\/\//.test(link))
			return link;
		var linkURI = new URI(link);
		if (!linkURI.protocol()) {
			var uri = new URI(link, this.path)
			uri.protocol("http");
			return uri.toString();
		}
		return link;
	};

	RSSParser.prototype.parsePostLink = function(links) {
		var $ = this.$;

		links = links.toArray().sort(function(a, b) {
			var ap = pointsForObject($(a));
			var bp = pointsForObject($(b));
			if (ap == bp)
				return 0;
			return ap > bp ? -1 : 1;
		});
		var link = links[0];
		if (!link)
			return false;

		link = this.$(link);

		var href = RSSParser.trimChars(link.attr("href") || link.text());
		return RSSParser.resolveFrom(link, href);

		function pointsForObject(a) {
			if (a.attr("isPermaLink") === "false")
				return -10;
			var rel = a.attr("rel");
			var type = a.attr("type");
			var points = -1;
			if (rel == "alternate")
				points += 2;
			if (type == "text/html")
				points += 2;
			return points;
		}
	};

	RSSParser.prototype.getGuid = function(post) {
		return post.find("guid, id").first();
	};

	RSSParser.prototype.getDate = function(post) {
		var datePublished = post.find('published, updated, pubDate, dc\\:date, date, created, issued').first();

		var date;
		if (datePublished.text()) {
			var txtDate = datePublished.text();
			date = new Date(txtDate).toDate();
		}

		if (! date || date === "Invalid Date" || isNaN(date.getTime()))
			date = 0
		else
			date = date.getTime();

		if (this.fixes.noPublished)
			return 0;

		return date;
	};

	RSSParser.prototype.foundPost = function(data) {
		if (! data.title || ! data.link)
			return;

		data.title = entities.decode(RSSParser.trimChars(data.title));
		data.link = RSSParser.trimChars(data.link);
		data.summary = data.summary;

		// If not http or https is present, or some other weird protocol, just assume it's relative
		if (! data.link.match(/^(http|https):/) && ! data.link.match(/^[a-zA-Z0-9-]+:/)) {
			var domain = this.getDomain(this.path);
			data.link = RSSParser.trimChars(domain, '/') + data.link;
		}

		if (this.fixes.noGUID)
			delete data.guid;
		this.posts.push(data);
	};

	RSSParser.prototype.getDomain = function(link) {
		return RSSParser.trimChars(link.substr(0, (link.indexOf("/", link.indexOf('.')) + 1) || link.length), '/') + '/';
	};

	RSSParser.prototype.feedHasBrokenPublishedDate = function() {
		this.posts.forEach(function(post) {
			post.published_from_feed = 0;
		});
	};

	RSSParser.matchTag = function(el, tagName) {
		do {
			if (el.is(tagName))
				return el;
		} while ( (el = el.parent()) && el.length );
		return false;
	}

	RSSParser.resolveFrom = function(ref, url) {
		var bases = [];
		var el = ref[0];
		while ( el && el.attribs ) {
			if (el.attribs["xml:base"])
				bases.push(el.attribs["xml:base"])
			el = el.parent;
		}

		if (! bases.length)
			return url;

		return new URI(url, bases.reduce(function(a, b) {
			return new URI(a, b).toString();
		})).toString();
	};

	RSSParser.trimChars = function(str, charlist) {
		if (!charlist) {
			return (str || "").trim();
		}

		charlist = charlist || ' \r\n\t';
	    var l = 0, i = 0;

	    var ret = str || "";

	    l = ret.length;
	    for (i = 0; i < l; i++) {
	        if (charlist.indexOf(ret.charAt(i)) === -1) {
	            ret = ret.substring(i);
	            break;
	        }
	    }

	    l = ret.length;
	    for (i = l - 1; i >= 0; i--) {
	        if (charlist.indexOf(ret.charAt(i)) === -1) {
	            ret = ret.substring(0, i + 1);
	            break;
	        }
	    }

	    return charlist.indexOf(ret.charAt(0)) === -1 ? ret : '';
	};

	RSSParser.cleanData = function(string) {
		return (string || "").replace(/<!\[CDATA\[(.*)\]\]>/, function(a, b) { return b; }).trim();
	};

	this.RSSParser = RSSParser;

	if (typeof module !== "undefined") {
		module.exports = RSSParser;
	}
})();
