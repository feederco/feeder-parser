// COOL FILE OF FEEDER FIXES

this.FIXES = {
	'http://www.zhihu.com/rss': {noPublished: true},
	'http://social.msdn.microsoft.com/search/en-US/feed?query=blogs&refinement=109': {noPublished: true, noGUID: true},
	'http://www.lebikini.com/programmation/rss': {noPublished: true}
}

if (typeof module !== "undefined") {
	module.exports = this.FIXES;
}