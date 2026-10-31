#!/bin/sh
set -eu
PROJECT_ROOT="$(cd "$SRCROOT/../.." && pwd)"
DESTINATION="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/Web"
mkdir -p "$DESTINATION"
for NAME in index.html pako.min.js style.css app.js native-adapter.js; do
    test -f "$PROJECT_ROOT/web/$NAME"
    cp "$PROJECT_ROOT/web/$NAME" "$DESTINATION/$NAME"
done
test -f "$PROJECT_ROOT/shared/sync-core.js"
cp "$PROJECT_ROOT/shared/sync-core.js" "$DESTINATION/sync-core.js"
if [ -f "$PROJECT_ROOT/web/host-hooks.js" ]; then cp "$PROJECT_ROOT/web/host-hooks.js" "$DESTINATION/host-hooks.js"; fi
if [ -f "$PROJECT_ROOT/web/sync-panel.js" ]; then cp "$PROJECT_ROOT/web/sync-panel.js" "$DESTINATION/sync-panel.js"; fi
# The resources are exact app source assets. Personal data and progress exports never enter this directory.
