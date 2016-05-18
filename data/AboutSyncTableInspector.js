let AboutSyncTableInspector = (function() {
  'use strict';
  const {DOM, PropTypes} = React;

  const indexSymbol = Symbol('index');

  function safeStringify(obj) {
    try {
      return JSON.stringify(obj);
    } catch (e) {
      return '<Recursive (double-click to expand)>';
    }
  }

  // By default String(Symbol('foo')) is 'Symbol(foo)', which is unlikely to be
  // what we want (also, ''+someSymbol throws). 
  function forceStr(s) {
    let str = String(s);
    if (typeof s === 'symbol') {
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
      if (typeof(aVal) === 'object') {
        aVal = safeStringify(aVal);
      }
      if (typeof(bVal) === 'object') {
        bVal = safeStringify(bVal);
      }
      return aVal === bVal ? 0 : (aVal < bVal ? 1 : -1);
    }
  }

  function defaultCellFormatter(cellValue, isExpanded, columnName, owningRow) {
    if (isExpanded) {
      return React.createElement(ReactInspector.ObjectInspector, {data: cellValue});
    }
    let cellString = '';
    let cellClass = `table-inspector-${typeof(cellValue)}-cell`
    if (typeof(cellValue) !== 'undefined') {
      cellString = safeStringify(cellValue);
    }
    return DOM.span({className: cellClass, title: cellString}, cellString);
  }

  class AboutSyncTableInspectorRow extends React.Component {
    constructor(props) {
      super(props);
      this.state = { isExpanded: false };
    }
    render() {

      const {tr, td} = DOM;
      return tr(
        {
          onDoubleClick: () => this.setState({ isExpanded: !this.state.isExpanded }),
          className: this.state.isExpanded ? 'table-inspector-expanded-row' : '',
        },
        this.props.columns.map(colName =>
          // Could also pass back 'original' row passed in with data[row[indexSymbol]],
          // but it's not clear that that's worth doing, especially since then
          // owningRow[columnName] wouldn't be reliable.
          td(
            {
              key: String(colName),
              className: 'col-'+forceStr(colName)
            },
            this.props.cellFormatter(
              this.props.data[colName], this.state.isExpanded, colName, this.props.data)
          )
        )
      );
    }
  }

  class AboutSyncTableInspector extends React.Component {
    constructor(props) {
      super(props);
      // default sort order is *ascending*, and the default sort key is the index.
      this.state = {
        sortBy: 0,
        sortOrder: 1
      };
    }

    getColumns(data) {
      let seenColumns = new Set();
      for (let i = 0; i < data.length; ++i) {
        let keys = Object.keys(data[i]);
        for (let j = 0; j < keys.length; ++j) {
          seenColumns.add(keys[j]);
        }
      }
      // Convert values() iterator to array
      return [...seenColumns.values()];
    }

    reorder(index) {
      if (this.state.sortBy !== index) {
        this.setState({ sortBy: index, sortOrder: 1 });
      } else {
        this.setState({ sortOrder: -this.state.sortOrder });
      }
    }

    render() {
      let {columns, data} = this.props;

      if (!columns || !columns.length) {
        columns = this.getColumns(data);
      } else {
        columns = columns.slice();
      }

      let rowData = data.map((item, index) =>
        Object.assign({ [indexSymbol]: index }, item));

      columns.unshift(indexSymbol);

      rowData.sort((a, b) => {
        let aVal = a[columns[this.state.sortBy]];
        let bVal = b[columns[this.state.sortBy]];
        return doSortBy(aVal, bVal) * this.state.sortOrder;
      });

      const {table, colgroup, col, thead, tr, th, tbody, td} = DOM;
      return table(
        { className: this.props.className },
        colgroup(null,
          columns.map(c => {
            let colName = 'col-'+forceStr(c);
            return col({ key: colName, className: colName });
          })
        ),
        thead(null,
          tr(null,
            columns.map((col, index) => {
              let glyph = '';
              if (this.state.sortBy === index) {
                glyph = this.state.sortOrder < 0 ? ' ▼' : ' ▲';
              }
              let colName = forceStr(col);
              return th({
                  key: String(col),
                  className: 'col-'+colName,
                  onClick: () => this.reorder(index),
                  style: { cursor: 'pointer' }
                },
                colName+glyph
              );
            })
          )
        ),
        tbody(null,
          rowData.map((row, index) =>
            React.createElement(AboutSyncTableInspectorRow, {
              columns,
              key: (row.id || row.guid)+':'+row[indexSymbol],
              data: row,
              cellFormatter: this.props.cellFormatter
            })
          )
        )
      );
    }
  }

  AboutSyncTableInspector.propTypes = {
    data: PropTypes.array.isRequired,
    columns: PropTypes.array,
    className: PropTypes.string,
    cellFormatter: PropTypes.func,
  };

  AboutSyncTableInspector.defaultProps = {
    cellFormatter: defaultCellFormatter,
    className: 'table-inspector',
  };

  return AboutSyncTableInspector;
}());
