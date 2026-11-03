#!/bin/sh
set -eu
PROJECT_ROOT="$(cd "$SRCROOT/../.." && pwd)"
DESTINATION="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/Web"
mkdir -p "$DESTINATION"
for NAME in index.html pako.min.js style.css app.js native-adapter.js sync-core.js content-pack.js learning-tools.js content-pack.json; do
    test -f "$PROJECT_ROOT/web/$NAME"
    cp "$PROJECT_ROOT/web/$NAME" "$DESTINATION/$NAME"
done
# Include nested offline audio and future verified local data assets as well.
# verify-resources.py checks every file and rejects symlinks before this phase.
cp -R "$PROJECT_ROOT/web/." "$DESTINATION/"
# The resources are exact app source assets. Personal data and progress exports never enter this directory.
