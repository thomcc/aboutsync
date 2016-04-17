let AboutSyncTableInspector = (function() {
  'use strict';

  const indexSymbol = Symbol('index');

  function safeStringify(obj) {
    try {
      return JSON.stringify(obj);
    } catch (e) {
      return '<Recursive>';
    }
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

  function defaultCellFormatter(cellValue, columnName, owningRow) {
    let cellString = '';
    let cellClass = `table-inspector-${typeof(cellValue)}-cell`
    if (typeof(cellValue) !== 'undefined') {
      cellString = safeStringify(cellValue);
    }
    return React.createElement('span',
      {className: cellClass, title: cellString},
      cellString);
  }

  class AboutSyncTableInspector extends React.Component {
    constructor(props) {
      super(props);
      // default sort order is *ascending*, and the default sort key is the index.
      this.state = {
        sortBy: 0,
        sortOrder: 1,
        expandedRows: {}
      };
    }

    expandRow(row) {
      // This should be moved into the row itself, so that we don't rerender
      // the whole table when this happens.
      let rowIndex = row[indexSymbol];
      this.state.expandedRows[rowIndex] = !this.state.expandedRows[rowIndex]
      this.setState({
        state: this.state.expandedRows
      });
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

      return React.createElement('table', { className: this.props.className },
        React.createElement('thead', null,
          React.createElement('tr', null,
            columns.map((col, index) => {
              let glyph = '';
              if (this.state.sortBy === index) {
                glyph = this.state.sortOrder < 0 ? ' ▼' : ' ▲';
              }
              // convert 'Symbol(index)' => '(index)'
              let colName = typeof col === 'symbol' ? String(col).slice(6) : col;
              return React.createElement('th', {
                  key: String(col),
                  onClick: () => this.reorder(index),
                  style: { cursor: 'pointer' }
                },
                colName+glyph
              );
            })
          )
        ),
        React.createElement('tbody', null,
          rowData.map((row, index) =>
            React.createElement('tr', {
                key: row.id+':'+row[indexSymbol],
                onDoubleClick: () => this.expandRow(row),
                className: this.state.expandedRows[row[indexSymbol]] ? 'table-inspector-expanded-row' : '',
              },
              columns.map(colName =>
                // Could also pass back 'original' row passed in with data[row[indexSymbol]],
                // but it's not clear that that's worth doing, especially since then
                // owningRow[columnName] wouldn't be reliable.
                React.createElement('td', {key: String(colName)}, 
                  this.props.cellFormatter(row[colName], colName, row)
                )
              )
            )
          )
        )
      );
    }
  }

  AboutSyncTableInspector.propTypes = {
    data: React.PropTypes.array.isRequired,
    columns: React.PropTypes.array,
    className: React.PropTypes.string,
    cellFormatter: React.PropTypes.func,
  };

  AboutSyncTableInspector.defaultProps = {
    cellFormatter: defaultCellFormatter,
    className: 'table-inspector',
  };

  return AboutSyncTableInspector;
}());
