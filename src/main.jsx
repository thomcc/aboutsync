const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

const React = require("react");
const ReactDOM = require("react-dom");

const { PrefsComponent } = require("./config");
const { ProviderState, ProviderInfo } = require("./provider");
const { AccountInfo, CollectionsViewer } = require("./components");
const { InternalAnchor, ErrorDisplay, Fetching } = require("./common");

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

// const LOGIN_STATE = {
//   UNKNOWN: "UNKNOWN"
//   LOGGED_IN: "LOGGED_IN",
//   LOGGED_OUT: "LOGGED_OUT",
// };

function EnableIf(props) {
  if (!this.props.enabled) {
    return null;
  }
  let wrapperType = this.props.wrapperType || "div";
  return <wrapperType {...props}>{this.props.children}</wrapperType>;
}

class AboutSyncHeader extends React.Component {
  renderAccountInfo() {
    if (!this.props.ready) {
      return null;
    }
    if (!this.props.loggedIn) {
      return (
        <div>
          You must <a href="about:preferences#sync">log in</a> to view about-sync
        </div>
      );
    }
    return (
      <div>
        <p className="section-heading">Firefox Account</p>
        <div id="account-info">
          <AccountInfo/>
        </div>
      </div>
    );
  }
  render() {
    return (
      <div className="header">
        <div>
          {this.renderAccountInfo()}
        </div>
        <div>
          <p className="section-heading">Sync Info</p>
          <div>
            <div>
              <InternalAnchor href="about:preferences#sync">
                Open Sync Preferences
              </InternalAnchor>
            </div>
            <div>
              {this.props.ready && <PrefsComponent/>}
            </div>
          </div>
        </div>
      </div>
    );
  }
}

class AboutSyncComponent extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      provider: null,
      loggedIn: false,
      ready: false,
    }
  }

  componentDidMount() {
    whenSyncReady().then(loggedIn => {
      this.setState({
        ready: true,
        loggedIn,
        provider: ProviderState.newProvider(),
      });
    }).catch(e => {
      this.setState({error: e})
    })
  }

  refreshProvider() {
    this.setState({
      provider: ProviderState.newProvider()
    });
  }

  render() {
    let loginState = this.state.ready ? String(this.state.loggedIn) : "unknown";
    return (
      <div>
        <div hidden={this.state.ready}>
          <Fetching label="Fetching account..."/>
        </div>

        <AboutSyncHeader loggedIn={this.state.loggedIn}
                         ready={this.state.ready}/>

        {this.state.loggedIn && (
          <div className="body">
            <div className="collections">
              <h2>Collections</h2>
              <button onClick={e => this.refreshProvider()}>Refresh</button>
              <CollectionsViewer provider={this.state.provider}/>
            </div>

            <ProviderInfo provider={this.state.provider}
                          updateProvider={() => this.refreshProvider()}/>
          </div>
        )}
      </div>
    );
  }
}


// let providerElement;

// document.getElementById("refresh-provider").addEventListener("click", () => {
//   providerElement.setState({ provider: ProviderState.newProvider() })
// });

// function render() {
//   // I have no idea what I'm doing re element attribute states :)
//   for (let elt of document.querySelectorAll(".state-container")) {
//     elt.setAttribute("data-logged-in", "unknown");
//   }
//   whenSyncReady().then(loggedIn => {
//     for (let elt of document.querySelectorAll(".state-container")) {
//       elt.setAttribute("data-logged-in", loggedIn);
//     }

//     // Render the nodes that exist in any state.
//     ReactDOM.render(React.createElement(PrefsComponent, null),
//                     document.getElementById("prefs")
//     );

//     ReactDOM.render(<InternalAnchor href="about:preferences#sync"/>,
//                     document.getElementById("opensyncprefs"));

//     if (!loggedIn) {
//       return;
//     }

//     // render the nodes that require us to be logged in.
//     ReactDOM.render(<AccountInfo/>, document.getElementById("account-info"));

//     providerElement = ReactDOM.render(<ProviderInfo/>, document.getElementById("provider-info"));

//   }).catch(err => console.error("render() failed", err));
// }

function render() {
  ReactDOM.render(<AboutSyncComponent/>, document.getElementById("main"));
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
