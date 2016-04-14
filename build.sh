#!/bin/bash
# screw trying to make this generic - it's trivial enough!

#uncomment to debug
#set -x

APP_NAME=aboutsync
XPI=$APP_NAME.xpi
ZIP_CMD="zip -9 -q"

rm $XPI
$ZIP_CMD $XPI README.md chrome.manifest install.rdf bootstrap.js

# The data directory non-recursively.
$ZIP_CMD $XPI data/*

# And the react stuff and components we need.
# Note we aren't using react via a submodule as there are no "built" files
# in the git repo. We could consider using a submodule and requiring a one-off
# local build and having those built files in our repo - maybe later...
$ZIP_CMD $XPI data/react-0.14.7/build/react-dom.js data/react-0.14.7/build/react.js

# The react components we use, all via git submodules
$ZIP_CMD $XPI data/react-inspector/build/react-inspector.js
$ZIP_CMD $XPI data/react-simpletabs/dist/react-simpletabs.js data/react-simpletabs/dist/react-simpletabs.css
$ZIP_CMD $XPI data/react-treeview/build/react-treeview.js

# Report details about what we created.
find $XPI -maxdepth 1 -printf '%f, %s bytes'
