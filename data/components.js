const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/FxAccounts.jsm");
Cu.import("resource://services-sync/main.js");
Cu.import("resource://services-sync/record.js");

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
  return React.createElement(ReactInspector.TableInspector, { data });
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
    let user;
    if (this.state.user == null) {
      user = "no user logged in";
    } else {
      user = this.state.user.email;
    }
    let tail = [];
    if (this.state.profile) {
      let profile = this.state.profile;
      tail.push(React.createElement('img', { src: profile.avatar, className: "profileImage" }));
      tail.push(createObjectInspector("Full Profile", profile));
    }

    return (
      React.createElement('div', null,
        React.createElement('p', null, user),
        ...tail
      ));
  }
}

// Renders a response
class ResponseViewer extends React.Component {
  render() {
    let response = this.props.response;
    let data = { url: response.url, status: response.status,
                 success: response.success, headers: response.headers };
    return createObjectInspector("Response", data);
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

      // now parent the item up, unless it's the places root which can stay as is.
      if (me.id !== 'places') {
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
          case "separator":
            label = "<Separator>";
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

    return {
      "Remote Tree": makeTreeFromNode(seen.get("places"), "Bookmarks Tree"),
      "Orphaned Items": makeTreeFromNode(seen.get("orphans"), "Orphaned Items"),
      "Deleted Items": createTableInspector(deletedTable),
      "Problems": React.createElement('div', null,
        React.createElement('p', {className: 'collectionSummary'}, `${problems.length} problems detected`),
        React.createElement('ul', {className: 'problemList'},
          ...problems.map(p => React.createElement('li', {key: p}, p))))
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
    let collection = new Collection(this.props.url, CryptoWrapper, Weave.Service);
    collection.full = true;
    let records = [];
    let key = Weave.Service.collectionKeys.keyForCollection(this.props.name);
    collection.recordHandler = record => {
      record.decrypt(key)
      records.push(record.cleartext);
    }
    // Do the actual fetch after an event spin.
    Promise.resolve().then(() => {
      let response = collection.get();
      this.setState({ response, records });
    }).catch(err => console.error("Failed to fetch collection", err));
  }

  render() {
    let name = this.props.name;
    let details = [React.createElement("div", { className: "collection-header" }, name)];
    if (this.state.records === undefined) {
      details.push(React.createElement(Fetching, { label: "Fetching records..." }));
    } else {
      // Build up a set of tabs.
      let lastModified = new Date(this.props.lastModified);
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
      let summaryBuilder = summaryBuilders[this.props.name];
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
                            React.createElement(ResponseViewer, { response: this.state.response })),
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

// Renders a "meta" resource - where the top-level response indicates what
// sub-resources are available (eg, meta/ or crypto/)
class MetaResourceViewer extends React.Component {
  constructor(props) {
    super(props);
    this.state = {};
  }

  componentDidMount() {
    let req = Weave.Service.resource(this.props.url);
    // Do the actual fetch after an event spin.
    Promise.resolve().then(() => {
      let response = req.get();
      // populate the names of the children first so we render the names
      // but with "fetching" for them.
      let children = {};
      for (let childName of response.obj) {
        children[childName] = null;
      }
      this.setState({ response, children }, () => {
        // OK, we've rendered the initial list, now fetch children.
        for (let childName of response.obj) {
          let childReq = Weave.Service.resource(this.props.url + "/" + childName);
          children[childName] = childReq.get();
        }
        this.setState({ children });
      });
    });
  }

  render() {
    if (!this.state.response) {
      return React.createElement(Fetching, { label: `Fetching ${this.props.url} ...` });
    }
    let obj = { response: this.state.response };
    for (let name in this.state.children) {
      let details;
      if (!this.state.children[name]) {
        obj[name] = "Fetching...";
      } else {
        obj[name] = JSON.parse(this.state.children[name].obj.payload);
      }
    }
    return React.createElement("div", null,
      React.createElement("span", null, this.props.name),
      React.createElement(ReactInspector.ObjectInspector, { data: obj })
    );
  }
}

// Drills into info/collections, grabs sub-collections, and renders them
class CollectionsViewer extends React.Component {
  componentDidMount() {
    // Sync's nested event-loop blocking API means we should do the fetch after
    // an event spin.
    Promise.resolve().then(() => {
      let info = Weave.Service._fetchInfo();
      this.setState({ info });
    }).catch(err => console.error("App init failed", err));
  }

  render() {
    if (!this.state || !this.state.info) {
      return React.createElement(Fetching, "Fetching collection info...");
    }

    let info = this.state.info;
    let collections = [];
    for (let name of Object.keys(info.obj).sort()) {
      let lastModified = new Date(info.obj[name]);
      let url = Weave.Service.storageURL + name;
      let props = { name, lastModified, url };

      if (name == "crypto" || name == "meta") {
        // These aren't encrypted "collections" so show them differently
        collections.push(
          React.createElement("div", null,
            React.createElement(MetaResourceViewer, { url, name })
          )
        );
      } else {
        collections.push(
          React.createElement(CollectionViewer, props)
        );
      }
    }
    return React.createElement("div", {foo: "bar"},
             React.createElement("p", null, "Status: " + info.status),
             ...collections
           );
  }
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

    ReactDOM.render(React.createElement(CollectionsViewer, null),
                    document.getElementById('collections-info')
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
