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

function createObjectInspector(name, data) {
  return React.createElement(ReactInspector.ObjectInspector, {name, data, expandLevel: 1 });
}

function createTableInspector(data) {
  return React.createElement(ReactInspector.TableInspector, { data });
}

// A placeholder for when we are still fetching data.
// Needs a spinner or something :)
class Fetching extends React.Component {
  render() {
    return React.createElement("p", { className: "fetching" }, "fetching...");
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
      record: null,
      children: [
        { id: "orphans", children: [] },
        { id: "places", children: [] },
        { id: "<deleted>", children: [] },
      ]
    };
    let seen = new Map();
    for (let child of root.children) {
      seen.set(child.id, child);
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

    // When all you have is a hammer... Turn it into something for ObjectInspector
    let data = {
      root,
      problems,
    };
    return {
      "Remote Tree": createObjectInspector("Remote Tree", data),
    };
  },

}

// Renders all collections.
class CollectionsViewer extends React.Component {
  componentDidMount() {
    whenSyncReady().then(loggedIn => {
      this.setState({ loggedIn });
      if (loggedIn) {
        let info = Weave.Service._fetchInfo();
        this.setState({ info });
      }
    }).catch(Cu.reportError);
  }

  render() {
    if (this.state && !this.state.loggedIn) {
      return React.createElement("p", null, "You must log in to view collections");
    }
    if (!this.state || !this.state.info) {
      return React.createElement(Fetching);
    }

    let info = this.state.info;
    let collections = [];
    for (let name in info.obj) {
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

// The "header" for a collection - info above the detail tabs.
class CollectionHeader extends React.Component {
  render() {
    let lastModified = new Date(this.props.parent.props.lastModified);
    let name = this.props.parent.props.name;
    return (
      React.createElement("div", { className: "collection-header" },
        React.createElement("span", null, name),
        React.createElement("span", { className: "collectionLastModified" }, " last modified at "),
        React.createElement("span", { className: "collectionLastModified" }, lastModified.toString())
      )
    )
  }
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
    });
  }

  render() {
    let details = [React.createElement(CollectionHeader, { parent: this })];
    if (this.state.records === undefined) {
      details.push(React.createElement(Fetching));
    } else {
      let tabs = [
        React.createElement(ReactSimpleTabs.Panel, { title: "Response" },
                            React.createElement(ResponseViewer, { response: this.state.response })),
        React.createElement(ReactSimpleTabs.Panel, { title: "Records" },
                            createTableInspector(this.state.records)),
      ];
      let summaryBuilder = summaryBuilders[this.props.name];
      if (summaryBuilder) {
        let summaries = summaryBuilder(this.state.records);
        for (let title in summaries) {
          let elt = summaries[title];
          tabs.push(React.createElement(ReactSimpleTabs.Panel, { title }, elt));
        }
      }
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
      return React.createElement(Fetching);
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

ReactDOM.render(React.createElement(AccountInfo, null),
                document.getElementById('account-info')
);
ReactDOM.render(React.createElement(CollectionsViewer, null),
                document.getElementById('collections-info')
);
