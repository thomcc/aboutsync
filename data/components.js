const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/FxAccounts.jsm");
Cu.import("resource://services-sync/main.js");

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

function createObjectInspector(name, data, expandLevel = 1) {
  return React.createElement(ReactInspector.ObjectInspector, {name, data, expandLevel: expandLevel });
}

function createTableInspector(data) {
  return React.createElement(AboutSyncTableInspector, { data });
}

// A tab-smart "anchor"
class InternalAnchor extends React.Component {
  onClick(event) {
    // Get the chrome (ie, browser) window hosting this content.
    let chromeWindow = window
         .QueryInterface(Ci.nsIInterfaceRequestor)
         .getInterface(Ci.nsIWebNavigation)
         .QueryInterface(Ci.nsIDocShellTreeItem)
         .rootTreeItem
         .QueryInterface(Ci.nsIInterfaceRequestor)
         .getInterface(Ci.nsIDOMWindow)
         .wrappedJSObject;
    chromeWindow.switchToTabHavingURI(this.props.href, true, {
      replaceQueryString: true,
      ignoreFragment: true,
    });
    event.preventDefault();
  }

  render() {
    return React.createElement("a",
                               { href: this.props.href,
                                 onClick: event => this.onClick(event),
                               },
                               this.props.children);
  }
}

// A placeholder for when we are still fetching data.
class Fetching extends React.Component {
  render() {
    return React.createElement("p", { className: "fetching" }, this.props.label);
  }
}

class AccountInfo extends React.Component {
  constructor(props) {
    super(props);
    this.state = { user: null, profile: null }
  }

  componentDidMount() {
    fxAccounts.getSignedInUser().then(data => {
      this.setState({ user: data });
      if (data) {
        fxAccounts.getSignedInUserProfile().then(profile => {
          this.setState({ profile });
        });
      }
    }).catch(Cu.reportError);
  }

  render() {
    let user = this.state.user;
    if (!user) {
      return React.createElement(Fetching, { label: "Fetching account info..." });
    }
    let avatar = [];
    let info = [];
    let raw = [];
    if (this.state.profile) {
      let profile = this.state.profile;
      avatar.push(React.createElement('img', { src: profile.avatar, className: "avatar" }));
      info.push(React.createElement('p', null, profile.displayName));
      raw.push(createObjectInspector("Full Profile", profile, 0));
    }
    info.push(React.createElement('p', null, user.email));

    return (
      React.createElement('div', null, [
        React.createElement('div', { className: "profileContainer" }, [
          React.createElement('div', { className: "avatarContainer" }, ...avatar),
          React.createElement('div', { className: "userInfoContainer" }, ...info),
        ]),
        ...raw,
      ])
    );
  }
}

// Functions that compute a "summary" object for a collection. Returns an
// object with key=name, value=react component.
const summaryBuilders = {
  bookmarks(records) {
    // Build a tree representation of the remote bookmarks.
    let problems = [];
    let deleted = new Set();

    let root = {
      id: "<root>",
      children: [
        { id: "orphans", children: [] },
        { id: "places", children: [] },
        { id: "<deleted>", children: [] },
      ]
    };
    let seen = new Map();
    for (let child of root.children) {
      seen.set(child.id, child);
      child.parent = root;
    }

    function makeItem(id, record) {
      let me = seen.get(id);
      if (me) {
        // My entry might already exist as it was seen as a parent - in which
        // case it shouldn't already have a record.
        if (record) {
          if (me.record) {
            problems.push(`Record ${id} appears processed twice`);
          }
          me.record = record;
        } else {
          // We're an item that was previously created - either due to seeing
          // the item itself, or due to being a parent we hadn't seen at the
          // time it was created.
          // If the latter we must have seen at least 1 child before.
          if (!me.record && !me.children.length) {
            // *sob* - our artificial children of the root hit this.
            if ([for (c of root.children) c.id].indexOf(id) == -1) {
              problems.push(`Record ${id} is an existing parent without children`);
            }
          }
        }
      } else {
        me = { id: id, children: [], record };
        seen.set(id, me);
      }

      // now parent the item up.
      if (record) {
        // We've got a real parentid (but not the record), so re-parent.
        let newParent = makeItem(record.parentid, null);
        if (newParent != me.parent) {
          if (me.parent) {
            // oh js, yu no have Array.remove()
            me.parent.children.splice(me.parent.children.indexOf(me), 1);
          }
          me.parent = newParent;
        }
        me.parent.children.push(me);
      } else {
        if (!me.parent) {
          // We created an item and we don't know its parent - parent it as
          // an orphan.
          me.parent = seen.get("orphans");
          me.parent.children.push(me);
        }
      }
      return me;
    }

    for (let record of records) {
      if (record.deleted) {
        // cheat for deleted items - this treats them as "normal" items, so
        // allows us to detect items that have a deleted item as a parent
        // (which would be bad!)
        record.parentid = "<deleted>";
      }
      makeItem(record.id, record);
    }

    // Make a TreeView DOM element from one of the nodes we build above.
    function makeTreeFromNode(node, label = null, depth = 1) {
      console.log("make tree", depth, node);
      let record = node.record || {};
      label = label || record.title;
      if (!label && record.deleted) {
        label = `deleted ${record.type} with id=${record.id}`;
      }
      if (!label) {
        switch (record.type) {
          case "query":
            label = "query: " + record.bmkUri;
            break;
          default:
            label = `<Untitled ${record.type}>`;
        }
      }
      let children = [];
      // Some children that form the "summary"...
      if (record.description) {
        children.push(React.createElement("p", { className: "bookmark-description"}, record.description));
      }
      let summary = `A ${record.type} with ${node.children.length} children`;
      children.push(React.createElement("p", { className: "bookmark-description"}, summary));
      children.push(createObjectInspector("record", record, 0));

      // And children that are sub-trees.
      let nodeLabel = React.createElement("span", null, label);
      for (let child of node.children) {
        children.push(React.createElement("div", null, makeTreeFromNode(child, null, depth + 1)));
      }
      return React.createElement(TreeView, { key: record.id, nodeLabel, defaultCollapsed: false },
                                 ...children);
    }
    // mangle <deleted> into a table
    let deletedTable = seen.get("<deleted>").children.map(child => {
      return { id: child.id, "num children": child.children.length };
    });
    // XXX - include "problems" here.
    return {
      "Remote Tree": makeTreeFromNode(seen.get("places"), "Bookmarks Tree"),
      "Orphaned Items": makeTreeFromNode(seen.get("orphans"), "Orphaned Items"),
      "Deleted Items": createTableInspector(deletedTable),
    };
  },

}

// Renders a single collection
class CollectionViewer extends React.Component {
  constructor(props) {
    super(props);
    this.state = {};
  }

  componentDidMount() {
    this.props.provider.promiseCollection(this.props.info).then(result => {
      let { response, records} = result;
      this.setState({ response, records });
    }).catch(err => console.error("Failed to fetch collection", err));
  }

  render() {
    let name = this.props.info.name;
    let details = [React.createElement("div", { className: "collection-header" }, name)];
    if (this.state.records === undefined) {
      details.push(React.createElement(Fetching, { label: "Fetching records..." }));
    } else {
      // Build up a set of tabs.
      let lastModified = new Date(this.props.info.lastModified);
      // "Summary" tab is first.
      let summary = React.createElement("div", null,
                      React.createElement("p", { className: "collectionSummary" }, `${this.state.records.length} records`),
                      React.createElement("span", { className: "collectionSummary" }, " last modified at "),
                      React.createElement("span", { className: "collectionSummary" }, lastModified.toString())
                    );

      let tabs = [
        React.createElement(ReactSimpleTabs.Panel, { title: "Summary"}, summary),
      ];
      // additional per-collection summaries
      let summaryBuilder = summaryBuilders[name];
      if (summaryBuilder) {
        let summaries = summaryBuilder(this.state.records);
        for (let title in summaries) {
          let elt = summaries[title];
          tabs.push(React.createElement(ReactSimpleTabs.Panel, { title }, elt));
        }
      }
      // and tabs common to all collections.
      tabs.push(...[
        React.createElement(ReactSimpleTabs.Panel, { title: "Response" },
                            createObjectInspector("Response", this.state.response)),
        React.createElement(ReactSimpleTabs.Panel, { title: "Records (table)" },
                            createTableInspector(this.state.records)),
        React.createElement(ReactSimpleTabs.Panel, { title: "Records (object)" },
                            createObjectInspector("Records", this.state.records)),
      ]);
      details.push(React.createElement(ReactSimpleTabs, null, tabs));
    }

    return React.createElement("div", { className: "collection" },
      ...details
    );
  }
}

// Drills into info/collections, grabs sub-collections, and renders them
class CollectionsViewer extends React.Component {
  componentWillReceiveProps(nextProps) {
    this.setState( {info: null });
    this._updateCollectionInfo(nextProps.provider);
  }

  componentDidMount() {
    this._updateCollectionInfo(this.props.provider);
  }

  _updateCollectionInfo(provider) {
    provider.promiseCollectionInfo().then(info => {
      this.setState({ info, error: null });
    }).catch(err => {
      console.error("Collection viewer failed", err);
      this.setState({ error: err });
    });
  }

  render() {
    if (this.state && this.state.error) {
      return React.createElement("div", null,
               React.createElement("p", null, "Failed to load collection: " + this.state.error)
             );
    }

    if (!this.state || !this.state.info) {
      return React.createElement(Fetching, "Fetching collection info...");
    }

    let provider = this.props.provider;
    let info = this.state.info;
    let collections = [];

    for (let collection of info.collections) {
      // We skip these 2 collections as they aren't encrypted so must be
      // rendered differently, and aren't particularly interesting.
      if (collection.name == "crypto" || collection.name == "meta") {
        continue;
      }
      collections.push(
        React.createElement(CollectionViewer, { provider, info: collection })
      );
    }
    return React.createElement("div", null,
             React.createElement("p", null, "Status: " + info.status),
             ...collections
           );
  }
}

// Options for what "provider" is used.
class ProviderOptions extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      local: ProviderState.useLocalProvider,
      url: ProviderState.url,
    };
  }

  componentWillUpdate(nextProps, nextState) {
    ProviderState.useLocalProvider = nextState.local;
    ProviderState.url = nextState.url;
  }

  render() {
    let onLocalClick = event => {
      this.setState({ local: true });
    };
    let onExternalClick = event => {
      this.setState({ local: false });
    };
    let onChooseClick = () => {
      const nsIFilePicker = Ci.nsIFilePicker;
      let titleText = "Select local file";
      let fp = Cc["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
      let fpCallback = result => {
        if (result == nsIFilePicker.returnOK) {
          this.setState({ url: fp.fileURL.spec })
        }
      }
      fp.init(window, titleText, nsIFilePicker.modeOpen);
      fp.appendFilters(nsIFilePicker.filterAll);
      fp.open(fpCallback);
    }
    let onInputChange = event => {
      this.setState({ url: event.target.value });
    }

    let local =
      React.createElement("p", null,
        React.createElement("input", { type: "radio", checked: this.state.local, onClick: onLocalClick }),
        React.createElement("span", null, "Load local Sync data")
      );
    let file =
      React.createElement("p", null,
        React.createElement("input", { type: "radio", checked: !this.state.local, onClick: onExternalClick }),
        React.createElement("span", null, "Load JSON from url"),
        React.createElement("span", { className: "provider-extra", hidden: this.state.local },
          React.createElement("input", { value: this.state.url, onChange: onInputChange }),
          React.createElement("button", {onClick: onChooseClick }, "Choose local file...")
        )
      );
    return React.createElement("div", null, local, file);
  }
}


class ProviderInfo extends React.Component {
  constructor(props) {
    super(props);
    this.state = { provider: ProviderState.newProvider() };
  }

  render() {
    let onLoadClick = () => {
      this.setState({ provider: ProviderState.newProvider() });
    }

    let onExportClick = () => {
      const nsIFilePicker = Ci.nsIFilePicker;
      let titleText = "Select name to export the JSON data to";
      let fp = Cc["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
      let fpCallback = result => {
        if (result == nsIFilePicker.returnOK || result == nsIFilePicker.returnReplace) {
          let filename = fp.file.QueryInterface(Ci.nsILocalFile).path;
          this.state.provider.promiseExport(filename).then(() => {
            alert("File created");
          }).catch(err => {
            console.error("Failed to create file", err);
            alert("Failed to create file: " + err);
          });
        }
      }

      fp.init(window, titleText, nsIFilePicker.modeSave);
      fp.appendFilters(nsIFilePicker.filterAll);
      fp.open(fpCallback);
    }

    ReactDOM.render(React.createElement(CollectionsViewer, { provider: this.state.provider }),
                    document.getElementById('collections-info'));

    let providerIsLocal = this.state.provider.type == "local";

    return React.createElement("fieldset", null,
             React.createElement("legend", null, "Data provider options"),
             React.createElement(ProviderOptions, null),
             React.createElement("button", { onClick: onLoadClick }, "Load"),
             React.createElement("button", { onClick: onExportClick, hidden: !providerIsLocal }, "Export to file...")
           );
  }
}

// I'm sure this is very un-react-y - I'm just not sure how it should be done.
let ProviderState = {
  newProvider() {
    if (this.useLocalProvider) {
      return new Providers.LocalProvider();
    }
    return new Providers.JSONProvider(this.url);
  },

  get useLocalProvider() {
    try {
      return Services.prefs.getBoolPref("extensions.aboutsync.localProvider");
    } catch (_) {
      return true;
    }
  },

  set useLocalProvider(should) {
    Services.prefs.setBoolPref("extensions.aboutsync.localProvider", should);
  },

  get url() {
    try {
      return Services.prefs.getCharPref("extensions.aboutsync.providerURL");
    } catch (_) {
      return "";
    }
  },

  set url(url) {
    Services.prefs.setCharPref("extensions.aboutsync.providerURL", url);
  },
}


function render() {
  // I have no idea what I'm doing re element attribute states :)
  // data-logged-in is already "unknown"
  whenSyncReady().then(loggedIn => {
    for (let elt of document.querySelectorAll(".state-container")) {
      elt.setAttribute("data-logged-in", loggedIn);
    }
    if (!loggedIn) {
      // the raw html and css has us covered!
      return;
    }
    // render our react nodes
    ReactDOM.render(React.createElement(AccountInfo, null),
                    document.getElementById('account-info')
    );

    ReactDOM.render(React.createElement(LogFilesComponent, null),
                    document.getElementById('logfiles-info')
    );

    ReactDOM.render(
      React.createElement(InternalAnchor,
                          { href: "about:preferences#sync"},
                          "Open Sync Preferences"),
      document.getElementById('opensyncprefs')
    );

    ReactDOM.render(React.createElement(ProviderInfo, null),
                    document.getElementById('provider-info')
    );
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
