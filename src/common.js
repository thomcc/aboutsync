// Utility components that are used in multiple places, but are too small to be
// worth putting in their own module.

const React = require("react");
const ReactInspector = require("react-inspector");

// A placeholder for when we are still fetching data.
class Fetching extends React.Component {
  render() {
    return React.createElement("p", { className: "fetching" }, this.props.label);
  }
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

// Wrapper around ReactInspector.ObjectInspector that sets some common props
// (theme, expandLevel)
function ObjectInspector(props) {
  // This lib isn't styled with CSS, so we have to go through this (the default
  // background is white, which looks bad).
  const theme = Object.assign({}, ReactInspector.chromeLight, {
    BASE_BACKGROUND_COLOR: "transparent"
  });
  return React.createElement(ReactInspector.ObjectInspector,
                             Object.assign({ theme, expandLevel: 1 }, props));
}

module.exports = {
  Fetching,
  InternalAnchor,
  ObjectInspector
};
