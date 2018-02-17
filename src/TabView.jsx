
const React = require("react");
const PropTypes = require("prop-types");

class TabView extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      current: 0
    };
  }

  onNavLinkClick(i, e) {
    e.preventDefault();
    if (i !== this.state.current) {
      this.setState({current: i});
    }
  }

  render() {
    let children = React.Children.toArray(this.props.children).filter(child => {
      return child && child.type == TabPanel;
    });
    return (
      <div className="tabs">
        <nav className="tabs-navigation">
          <ul className="tabs-menu">
            {children.map((tab, i) => {
              let className = "tabs-menu-item";
              if (i == this.state.current) {
                className += " is-active"
              }
              return (
                <li className={className} key={tab.props.name}>
                  <a href="#" onClick={e => this.onNavLinkClick(i, e)}>
                    {tab.props.name}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <article className="tab-panel">
          {children[this.state.current]}
        </article>
      </div>
    );
  }
};

function TabPanel(props) {
  return <div className="tabs-panel is-active">{props.children}</div>;
}

module.exports = { TabView, TabPanel };
