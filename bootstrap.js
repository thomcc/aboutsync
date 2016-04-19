const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/Preferences.jsm");

const INDEX_HTML = "chrome://aboutsync/content/index.html";

const PREF_VERBOSE = "extensions.aboutsync.verbose";
let verbose = false;

function log(...args) {
  console.log(" *** aboutsync: ", ...args);
}

function debug(...args) {
  if (verbose) {
    console.log(" ***** aboutsync: ", ...args);
  }
}

// Utilities to initialize the addon...
function loadIntoWindow(window) {
  if (!window)
    return;
  let wintype = window.document.documentElement.getAttribute('windowtype');
  if (wintype != "navigator:browser") {
    log("not installing aboutsync extension into window of type " + wintype);
    return;
  }
  // Add persistent UI elements to the "Tools" ment.
  let menuItem = window.document.createElement("menuitem");
  menuItem.setAttribute("id", "aboutsync-menuitem");
  menuItem.setAttribute("label", "About Sync");
  menuItem.addEventListener("command", function(event) {
    let win = event.target.ownerDocument.defaultView;
    let tab = win.gBrowser.addTab(INDEX_HTML, { forceNotRemote: true });
    win.gBrowser.selectedTab = tab;
  }, true);
  let menu = window.document.getElementById("menu_ToolsPopup");
  if (!menu) {
    // might be a popup or similar.
    log("not installing aboutsync extension into browser window as there is no Tools menu");
  }
  menu.appendChild(menuItem);
  debug("installing aboutsync into new window");
}

function unloadFromWindow(window) {
  if (!window)
    return;
  window.document.getElementById("aboutsync-menuitem").remove();
  // Remove any persistent UI elements
  // Perform any other cleanup
}

let windowListener = {
  onOpenWindow: function(aWindow) {
    // Wait for the window to finish loading
    let domWindow = aWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
    domWindow.addEventListener("load", function onLoad() {
      domWindow.removeEventListener("load", onLoad, false);
      loadIntoWindow(domWindow);
    }, false);
  },

  onCloseWindow: function(aWindow) {},
  onWindowTitleChange: function(aWindow, aTitle) {}
};

function prefObserver(subject, topic, data) {
  switch (data) {
    case PREF_VERBOSE:
      try {
        verbose = Services.prefs.getBoolPref(PREF_VERBOSE);
      } catch (ex) {}
      break;
  }
}

/* A facility for this addon to "persist" certain preferences across
   Sync resets.

   In general, these preferences are exposed in the addon's UI - but the
   preference must live here so that it works even when the addon's UI isn't
   open.
*/
const PREF_RESTORE_TOPICS = [
  "weave:service:start-over",
  "weave:service:start-over:finish",
];

const PREFS_TO_RESTORE = [
  "services.sync.log.appender.file.level",
  "services.sync.log.appender.dump",
  "services.sync.log.appender.file.logOnSuccess",
];

let savedPrefs = null;
// The observer for the notifications Sync sends as it resets.
function startoverObserver(subject, topic, data) {
  if (!Preferences.get("extensions.aboutsync.applyOnStartOver")) {
    log("Sync is being reset, but aboutsync is not configured to restore prefs.");
    return;
  }
  switch (topic) {
    case "weave:service:start-over":
      // Sync is about to reset all its prefs - save them.
      log("Sync is starting over - saving pref values to restore");
      savedPrefs = {};
      for (let pref of PREFS_TO_RESTORE) {
        savedPrefs[pref] = Preferences.get(pref);
      }
      break;

    case "weave:service:start-over:finish":
      // Sync has completed resetting its world.
      log("Sync startover is complete - restoring pref values");
      for (let pref of Object.keys(savedPrefs)) {
        Preferences.set(pref, savedPrefs[pref]);
      }
      savedPrefs = null;
      break;

    default:
      log("unexpected topic", topic);
  }
}

/*
 * Extension entry points
 */
function startup(data, reason) {
  log("starting up");
  // Watch for prefs we care about.
  Services.prefs.addObserver(PREF_VERBOSE, prefObserver, false);
  // Ensure initial values are picked up.
  prefObserver(null, "", PREF_VERBOSE);
  // Setup our "pref restorer"
  for (let topic of PREF_RESTORE_TOPICS) {
    Services.obs.addObserver(startoverObserver, topic, false);
  }

  // Load into any existing windows
  let windows = Services.wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    loadIntoWindow(domWindow);
  }

  // Load into any new windows
  Services.wm.addListener(windowListener);
}

function shutdown(data, reason) {
  // When the application is shutting down we normally don't have to clean
  // up any UI changes made
  if (reason == APP_SHUTDOWN)
    return;

  let wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);

  // Stop listening for new windows
  wm.removeListener(windowListener);

  // Unload from any existing windows
  let windows = wm.getEnumerator("navigator:browser");
  while (windows.hasMoreElements()) {
    let domWindow = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
    try {
      unloadFromWindow(domWindow);
    } catch (ex) {
      log("Failed to reset window: " + ex + "\n" + ex.stack);
    }
  }
  Services.prefs.removeObserver(PREF_VERBOSE, prefObserver);

  for (let topic of PREF_RESTORE_TOPICS) {
    Services.obs.removeObserver(startoverObserver, topic);
  }
}

function install(data, reason) {}
function uninstall(data, reason) {}
