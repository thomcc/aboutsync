"use strict";
const React = require("react");
const PropTypes = require("prop-types");

const indexSymbol = Symbol("index");
const recordSymbol = Symbol("record");

const { ObjectInspector } = require("./common");

function safeStringify(obj, replacer, space) {
  try {
    return JSON.stringify(obj, replacer, space);
  } catch (e) {
    return "<Recursive (double-click to expand)>";
  }
}

// By default String(Symbol('foo')) is 'Symbol(foo)', which is unlikely to be
// what we want (also, ''+someSymbol throws).
function forceStr(s) {
  let str = String(s);
  if (typeof s === "symbol") {
    return str.slice(6);
  }
  return str;
}

function doSortBy(aVal, bVal) {
  if ((aVal === undefined) !== (bVal === undefined)) {
    // only one undefined
    return (aVal === undefined ? 0 : 1) - (bVal === undefined ? 0 : 1);
  }

  if (!(isNaN(parseInt(aVal, 10)) || isNaN(parseInt(bVal, 10)))) {
    return parseInt(aVal, 10) - parseInt(bVal, 10);
  } else {
    if (typeof(aVal) === "object") {
      aVal = safeStringify(aVal);
    }
    if (typeof(bVal) === "object") {
      bVal = safeStringify(bVal);
    }
    return aVal === bVal ? 0 : (aVal < bVal ? 1 : -1);
  }
}

function defaultCellFormatter(cellValue, isExpanded, columnName, owningRow, sensitive) {
  if (isExpanded) {
    return <ObjectInspector data={cellValue}/>;
  }
  if (sensitive.indexOf(columnName) >= 0) {
    return "**** hidden unless expanded ****";
  }
  let cellString = "";
  let title = "";
  let cellClass = `table-inspector-${typeof(cellValue)}-cell`;
  if (typeof(cellValue) !== "undefined") {
    cellString = safeStringify(cellValue);
    // a multi-line tooltip seems to have different length constraints...
    title = safeStringify(cellValue, undefined, 2);
  }
  return <span className={cellClass} title={title}>{cellString}</span>;
}

class TableInspectorRow extends React.Component {
  constructor(props) {
    super(props);
    this.state = { isExpanded: false };
  }
  render() {
    return (
      <tr className={this.state.isExpanded ? "table-inspector-expanded-row" : ""}
          onDoubleClick={() => this.setState({ isExpanded: !this.state.isExpanded })}>
        {this.props.columns.map(colName =>
          // Could also pass back 'original' row passed in with data[row[indexSymbol]],
          // but it's not clear that that's worth doing, especially since then
          // owningRow[columnName] wouldn't be reliable.
          <td key={String(colName)}>
            {this.props.cellFormatter(this.props.data[colName],
                                      this.state.isExpanded,
                                      colName,
                                      this.props.data,
                                      this.props.sensitiveColumns)}
          </td>
        )}
      </tr>
    );
  }
}

class TableInspector extends React.Component {
  constructor(props) {
    super(props);
    // default sort order is *ascending*, and the default sort key is the index.
    this.state = {
      sortBy: 0,
      sortOrder: 1,
      currentDragTarget: null,
      dragTargetStartWidth: null,
      dragTargetStartX: 0,
      columnWidths: {},
    };
    // Allow unbinding these without hassles...
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    setTimeout(() => this.setState({}), 5)
  }

  componentDidMount() {
    window.addEventListener("mouseup", this._onMouseUp);
    window.addEventListener("mousemove", this._onMouseMove);
  }

  componentWillUnmount() {
    window.removeEventListener("mouseup", this._onMouseUp);
    window.removeEventListener("mousemove", this._onMouseMove);
  }

  componentWillReceiveProps(newProps) {
    this._cachedColumns = null;
    this._cachedRows = null;
  }

  getColumns(data) {
    let seenColumns = new Set();
    for (let i = 0; i < data.length; ++i) {
      if (data[i] == null) {
        continue;
      }
      let keys = Object.keys(data[i]);
      for (let j = 0; j < keys.length; ++j) {
        seenColumns.add(keys[j]);
      }
    }
    // Convert values() iterator to array
    return [...seenColumns.values()];
  }

  reorder(index) {
    this._cachedColumns = null;
    this._cachedRows = null;
    if (this.state.sortBy !== index) {
      this.setState({ sortBy: index, sortOrder: 1 });
    } else {
      this.setState({ sortOrder: -this.state.sortOrder });
    }
  }

  _onMouseMove(event) {
    if (!this.state.currentDragTarget) return;
    event.preventDefault();
    let {currentDragTarget, dragTargetStartWidth, dragTargetStartX, columnWidths} = this.state;
    let newWidth = dragTargetStartWidth+(event.clientX-dragTargetStartX);
    if (newWidth < 45) {
      newWidth = 45;
    }
    columnWidths[currentDragTarget] = newWidth;
    // hacky: avoid the setState to avoid full rerender, and just update in place...

    // note that both the <th> and the <col> need to be updated for it not to render super small initially.
    let refName = "col-" + currentDragTarget;
    this.refs[refName].style.width = newWidth + "px";
    let elem = this.refs[currentDragTarget + "-header"];
    elem.style.minWidth = newWidth + "px";
    elem.style.maxWidth = newWidth + "px";
    elem.style.width = newWidth + "px";
  }

  _onMouseUp() {
    if (!this.state.currentDragTarget) return;
    this.setState({ currentDragTarget: null });
  }

  componentDidUpdate() {
    if (!this._cachedColumns) {
      return;
    }
    let setAny = false;
    let checkCol = (col) => {
      if (!this.state.columnWidths[col]) {
        this.state.columnWidths[col] = Math.min(150,
          this.refs[forceStr(col) + "-header"].offsetWidth + 2); // 1px borders padding
        setAny = true;
      }
    }
    for (let col of this._cachedColumns) {
      checkCol(col);
    }
    checkCol(forceStr(indexSymbol));
    checkCol(forceStr(recordSymbol));
    if (setAny) {
      this.setState({columnWidths: this.state.columnWidths});
    }
  }

  _onMouseDown(event, colName) {
    let thElem = this.refs[colName + "-header"];
    if (!thElem) {
      console.warn("No such header ref: " + colName);
      return;
    }
    event.preventDefault();
    let handle = event.target;
    let columnWidths = this.state.columnWidths;

    let currentWidth = columnWidths[colName] || thElem.offsetWidth;
    let currentMx = event.clientX;
    let xOffset = 0;//handle ? (currentMx - handle.getBoundingClientRect().left) : 0;
    currentMx += xOffset;

    columnWidths[colName] = currentWidth;

    this.setState({
      columnWidths,
      currentDragTarget: colName,
      dragTargetStartWidth: currentWidth,
      dragTargetStartX: currentMx,
    });
  }

  _updateCache() {
    // recomputing these every time was the source of a good amount of lag on
    // larger tables, so we cache it (sadly, the cache has to be cleared
    // explicitly...)
    let {columns, data} = this.props;

    if (!columns || !columns.length) {
      columns = this.getColumns(data);
    } else {
      columns = columns.slice();
    }

    let rowData = data.map((item, index) =>
      Object.assign({ [indexSymbol]: index, [recordSymbol]: item }, item))

    columns = [indexSymbol, recordSymbol].concat(columns);

    rowData.sort((a, b) => {
      let aVal = a[columns[this.state.sortBy]];
      let bVal = b[columns[this.state.sortBy]];
      return doSortBy(aVal, bVal) * this.state.sortOrder;
    });

    this._cachedColumns = columns;
    this._cachedRows = rowData;
  }

  render() {
    if (!this._cachedRows || !this._cachedColumns) {
      this._updateCache();
    }

    let {_cachedColumns: columns, _cachedRows: rowData} = this;
    let tableStyle = {};
    let haveComputedNaturalWidths = !!this.state.columnWidths[forceStr(indexSymbol)];
    if (haveComputedNaturalWidths) {
      tableStyle.width = "100%";
    } else {
      // avoid pop-in
      tableStyle.visibility = "hidden";
    }
    return (
      <table className={this.props.className} style={tableStyle}>
        <colgroup>
          {columns.map(c => {
            let colName = forceStr(c);
            let colClass = "col-" + colName;
            let style = {};
            if (this.state.columnWidths[colName]) {
              style.width = this.state.columnWidths[colName] + "px";
            }
            return <col style={style} key={colClass} className={colClass} ref={colClass}/>;
          })}
        </colgroup>
        <thead>
          <tr key="heading">
            {columns.map((col, index) => {
              let glyph = "";
              if (this.state.sortBy === index) {
                glyph = this.state.sortOrder > 0 ? " ▼" : " ▲";
              }
              let colName = forceStr(col);
              let style = {};
              if (this.state.columnWidths[colName]) {
                style.minWidth = this.state.columnWidths[colName] + "px";
                style.maxWidth = this.state.columnWidths[colName] + "px";
                style.width = this.state.columnWidths[colName] + "px";
              }
              return (
                <th style={style} key={colName} ref={colName + "-header"}>
                  <span onClick={() => this.reorder(index)}>
                    {colName + glyph}
                  </span>
                  <span className="resizer"
                        onMouseDown={e => this._onMouseDown(e, colName)}/>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rowData.map((row, index) =>
            <TableInspectorRow
              columns={columns}
              key={`${row.id || row.guid}:${row[indexSymbol]}`}
              data={row}
              cellFormatter={this.props.cellFormatter}
              sensitiveColumns={this.props.sensitiveColumns}/>
          )}
        </tbody>
      </table>
    );
  }
}

TableInspector.propTypes = {
  data: PropTypes.array.isRequired,
  columns: PropTypes.array,
  className: PropTypes.string,
  cellFormatter: PropTypes.func,
  sensitiveColumns: PropTypes.array,
};

TableInspector.defaultProps = {
  cellFormatter: defaultCellFormatter,
  className: "table-inspector",
  sensitiveColumns: ["password"]
};

module.exports = {
  TableInspector: TableInspector
};
