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

# Now try and sign it!
# See https://mana.mozilla.org/wiki/display/SVCOPS/Sign+a+Mozilla+Internal+Extension for the gory details,
# but you will need to have setup a number of environment variables and
# activated a virtualenv for this to work.
# XXX - need at least:
# AWS_ACCESS_KEY_ID, AWS_DEFAULT_REGION, AWS_SECRET_ACCESS_KEY, MOZENV

rm aboutsync-signed.xpi
echo
echo Uploading XPI to sign...
sign-xpi -t mozillaextension -e $MOZENV -s net-mozaws-$MOZENV-addons-signxpi-input aboutsync.xpi
echo Downloading signed XPI...
aws s3 cp s3://net-mozaws-$MOZENV-addons-signxpi-output/aboutsync.xpi ./aboutsync-signed.xpi
