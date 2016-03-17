# About Sync

...

# Development

The easiest way to develop/debug this is:

* In your profile directory's "extensions" subdir, create a file named
  about-sync@mhammond.github.com
* Add a line to this file with the full path to the addon source dir.  Be sure
  to include the trailing slash (or backslash if on Windows)
* Start Firefox and open chrome://aboutsync/content/index.html (or use the
  new entry created on the "Tools" menu)
* When using the addon this way, you can make changes to the HTML/CSS/JS and
  they will be picked up when you refresh the page - there's no need to
  restart the browser (however, changes to bootstrap.js typically *will*
  require a restart)

Other notes:
* To see verbose debug messages from bootstrap.js, create a boolean preference
  "extensions.aboutsync.verbose" to true - message will be sent to the browser
  console.

