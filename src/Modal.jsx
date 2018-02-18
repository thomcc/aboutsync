const React = require("react");
const ReactDOM = require("react-dom");

class Modal extends React.Component {
  static get defaultProps() {
    return {
      className: "",
      title: ""
    };
  }

  constructor(props) {
    super(props);
    this.state = {
      // if the user passe an open prop, we only use that. the state is
      // used for cases where the user doesn't care.
      open: true,
      isManaged: this.props.hasOwnProperty("open")
    };
    this.el = document.createElement("div");
    this.modalRoot = document.getElementById("modal-root")
    this.onKeyPress = this.onKeyPress.bind(this);
  }

  componentDidMount() {
    this.modalRoot.appendChild(this.el);
    window.addEventListener("keypress", this.onKeyPress);
  }

  componentWillUnmount() {
    this.modalRoot.removeChild(this.el);
    window.removeEventListener("keypress", this.onKeyPress);
  }

  close() {
    if (this.props.onClose) {
      this.props.onClose();
    }
    this.setState({open: false});
  }

  onKeyPress(e) {
    if (this.isOpen() && e.key === "Escape") {
      this.close();
    }
  }

  onClickClose(e) {
    e.preventDefault();
    this.close();
  }

  renderInner() {
    // Weirdly, react bubbles events through portals, and doesn't (yet) let
    // you turn it off, instead recommending that you do this.
    return <div onClick={e => e.stopPropagation()}>
      <div className="modal-backdrop"
           onClick={e => this.onClickClose(e)}/>
      <div className="modal-container">
        <div className={"modal-wrap " + this.props.className} onKeyPress={e => this.onKeyPress(e)}>
          <div className="modal-heading">
            <h4>{this.props.title}</h4>
            <button className="modal-close" onClick={e => this.onClickClose(e)}>&times;</button>
          </div>
          <div className="modal-body">
            {this.props.children}
          </div>
        </div>
      </div>
    </div>;

  }

  isOpen() {
    return this.props.open || (this.state.isManaged && this.state.open);
  }

  render() {
    if (!this.isOpen()) {
      return null;
    }
    return ReactDOM.createPortal(this.renderInner(), this.el);
  }
}

module.exports = { Modal };
