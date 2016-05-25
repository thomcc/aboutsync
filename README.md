# About Sync

This addon shows information about your Sync account, including showing all
server data for your account. It is designed primarily for Sync developers, or
advanced users who would like some insights into their Sync data.

Once installed, you can either select "About Sync" from the tools menu, or
just paste chrome://aboutsync/content/index.html into a tab.

The source code is at https://github.com/mhammond/aboutsync and pull requests
are welcome!

# Development

The easiest way to develop/debug this is:

* Clone the git repo locally.
* In about:config, set the preference xpinstall.signatures.required to false,
  then quit Firefox.
* In your profile directory's "extensions" subdir, create a file named
  aboutsync@mhammond.github.com
* Add a line to this file with the full path to the addon source dir.  Be sure
  to include the trailing slash (or backslash if on Windows)
* Start Firefox - you may be prompted about the "unexpected" install of the
  addon - confirm that you really do want to install it.
* Open chrome://aboutsync/content/index.html (or use the new "About Sync" entry
  created in the "Tools" menu)
* When using the addon this way, you can make changes to the HTML/CSS/JS and
  they will be picked up when you refresh the page - there's no need to
  restart the browser (however, changes to bootstrap.js typically *will*
  require a restart.) Changes to the CSS seem to be somewhat ignored by
  Firefox, but using the devtools and making a whitespace-only change to the
  CSS seems to pick up the new version - I need to work out how to fix this.

Other notes:
* To see verbose debug messages from bootstrap.js, create a boolean preference
  "extensions.aboutsync.verbose" to true - message will be sent to the browser
  console. Note that console.log etc can be used in the "data" JS.

