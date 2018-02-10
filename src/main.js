const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

const React = require("react");
const ReactDOM = require("react-dom");

const { PrefsComponent } = require("./config");
const { ProviderState } = require("./provider");
const { AccountInfo, ProviderInfo } = require("./components");
const { InternalAnchor } = require("./common");

const weaveService = Cc["@mozilla.org/weave/service;1"]
                     .getService(Ci.nsISupports)
                     .wrappedJSObject;

// Returns a promise that resolves when Sync is ready and logged in.
function whenSyncReady() {
  return weaveService.whenLoaded().then(() => {
    // If we don't have a user we are screwed.
    return fxAccounts.getSignedInUser();
  }).then(userData =>  {
    if (!userData) {
      return false;
    }
    if (Weave.Service.isLoggedIn) {
      return true;
    }
    return new Promise(resolve => {
      const TOPIC = "weave:service:login:finish";
      function observe(subject, topic, data) {
        Services.obs.removeObserver(observe, TOPIC);
        resolve(true);
      }
      Services.obs.addObserver(observe, TOPIC, false);
      Weave.Service.login();
    });
  });
}


let providerElement;

document.getElementById("refresh-provider").addEventListener("click", () => {
  providerElement.setState({ provider: ProviderState.newProvider() })
});

function render() {
  // I have no idea what I'm doing re element attribute states :)
  for (let elt of document.querySelectorAll(".state-container")) {
    elt.setAttribute("data-logged-in", "unknown");
  }
  whenSyncReady().then(loggedIn => {
    for (let elt of document.querySelectorAll(".state-container")) {
      elt.setAttribute("data-logged-in", loggedIn);
    }

    // Render the nodes that exist in any state.
    ReactDOM.render(React.createElement(PrefsComponent, null),
                    document.getElementById("prefs")
    );

    ReactDOM.render(
      React.createElement(InternalAnchor,
                          { href: "about:preferences#sync"},
                          "Open Sync Preferences"),
      document.getElementById("opensyncprefs")
    );

    if (!loggedIn) {
      return;
    }
    // render the nodes that require us to be logged in.
    ReactDOM.render(React.createElement(AccountInfo, null),
                    document.getElementById("account-info")
    );

    providerElement = ReactDOM.render(React.createElement(ProviderInfo, null),
                                      document.getElementById("provider-info"));

  }).catch(err => console.error("render() failed", err));
}

// An observer that supports weak-refs (but kept alive by the window)
window.myobserver = {
  QueryInterface: function(iid) {
    if (!iid.equals(Ci.nsIObserver) &&
        !iid.equals(Ci.nsISupportsWeakReference) &&
        !iid.equals(Ci.nsISupports))
      throw Cr.NS_ERROR_NO_INTERFACE;

    return this;
  },
  observe: function(subject, topic, data) {
    render();
  }
};

function main() {
  render();

  const topics = [
    "fxaccounts:onlogin",
    "fxaccounts:onverified",
    "fxaccounts:onlogout",
    "fxaccounts:update",
    "fxaccounts:profilechange"
  ];
  for (let topic of topics) {
    Services.obs.addObserver(window.myobserver, topic, true);
  }
}

main();
