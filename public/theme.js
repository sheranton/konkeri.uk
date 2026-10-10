// Applies a saved colour theme before first paint. It lives in its own file
// because the site's Content-Security-Policy forbids inline scripts.
try {
	var theme = localStorage.getItem("theme");
	if (theme === "paper" || theme === "ink") document.documentElement.dataset.theme = theme;
} catch (e) {}
