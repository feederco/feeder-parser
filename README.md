
feeder-parser
=============

An extremely pragmatic approach to parsing RSS and Atom feeds. Used to run [feeder.co](http://feeder.co) extension and pro service.

Tests need to be ported to this repo...

```javascript
var http = require("http");

var RSSParser = require("feeder-parser").RSSParser;

// The first parameter to the RSSParser constructor should be an object with a `path` attribute
var feed = {
	path: "http://www.reddit.com/r/all.rss"
}

function parse(body) {
	var parser = new RSSParser(feed);
	parser.setResult(body);
	parser.parse(function(parser) {
		parser.posts.forEach(function(post) {
			console.log(post.title);
		});
	});
}

function fetch(url, callback) {
	http.get(url, function(res) {
		var data = [];

		res.setEncoding("utf8");
		res.on("data", function(chunk) {
			data.push(chunk);
		});

		res.on("end", function() {
			callback(data.join(""));
		});
	});
}

fetch(feed.path, parse);
```