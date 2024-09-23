import DB from 'psql-bindings';

/**
 * Remove special chars from search string
 *
 * @param search {string}
 * @return {string}
 */
export const removeSpecialSymbols = (search) => {
  const regexp = /[\][}{!\\<|>,"#&*+?`$)(^%~':;№=]/g;

  return search.trim().replace(regexp, '');
};

/**
 * Helper for filtering data that create conditions and bindings for a query
 *
 * P.S. Needs to add all joins (see table key) of tables when you create a query for filtering data
 *
 * Example of rules:
 *
 * // Association field type with db table (needs for correct filtering)
 *  const FILTER_WITH_TABLES = {
 *   month: {
 *     table: 'data.users',
 *     field: 'created_at',
 *     query: 'EXTRACT(MONTH FROM data.users.created_at) = :value'
 *   },
 *   year: {
 *     table: 'data.users',
 *     field: 'created_at',
 *     query: 'EXTRACT(YEAR FROM data.users.created_at) = :value'
 *   },
 *   role: {
 *     table: 'data.user_roles',
 *     field: 'role',
 *     query: ':value = ANY(data.user_roles.roles)'
 *   },
 *   active: {
 *     table: 'data.users',
 *     field: 'active',
 *     query: null
 *   }
 * };
 *
 * @param filters {object} filter
 * @param rules {object} with filter rules
 *
 * @return {array} of objects with conditions in the format: [{ query: 'Condition query string', binding: { key: value } }]
 */
const filtersHelper = ({filters = {}, rules}) => {
  const where = [];

  if (Object.keys(filters).length) {
    for (const [key, value] of Object.entries(filters)) {
      const tableData = rules[key];
      const table = tableData.table;
      const field = tableData.field;
      const query = tableData.query?.replaceAll(':value', `:${key}`);

      // If exist manual query
      where.push({
        query: query || `${table}.${field} = :${key}`,
        binding: {[key]: value}
      });
    }
  }

  return where;
};

/**
 * Create string with conditions and bindings
 *
 * @param whereConditions {array} with objects { query, binding: { key: value }}
 * @param doNotAddWhere {boolean} if true then don't need to add WHERE to a query
 *
 * @return {object} with two attributes: where {string}, bindings {object} { key: value }
 */
const createWhereQuery = ({whereConditions, doNotAddWhere = false}) => {
  const conditions = [];
  let bindings = {};
  let where = '';

  whereConditions?.forEach(({query}) => {
    if (query) conditions.push(`(${query})`);
  });

  if (conditions.length) where = conditions?.join(' AND ');

  whereConditions.forEach(({binding}) => {
    bindings = {...bindings, ...binding};
  });

  if (where.length) where = doNotAddWhere ? ` AND ${where}` : ` WHERE ${where}`;

  return {where, bindings};
};

/**
 * Create meta query (order, offset, etc)
 * Needs to use as last query element
 *
 * @param meta {object} meta data (perPage: Int
 *                                 offset: Int
 *                                 order: String
 *                                 orderBy: String)
 * @param table {string} table name with schema name (data.users) for sorting
 * @param orderRaw {string} sql order string, for example:
 *                              'ORDER BY t.year DESC, t.month DESC, t.week DESC'
 *                          If exist then we will use this data instead meta.order/meta.orderBy/sortingTableName
 * @return {object} with two attributes: sorting {string}, bindings {object} { key: value }
 */
const createMetaQuery = (meta, table, orderRaw) => {
  const PER_PAGE = 25;
  const OFFSET = 0;

  let bindings = {};
  let sorting = '';

  /**
   * Create order query from meta
   */
  const sortByMetaOrder = () => {
    const order = meta?.order?.toUpperCase() || 'ASC';

    if (order && !['ASC', 'DESC'].includes(order)) throw new Error('Incorrect order value! Need use only ASC or DESC!');

    if (meta?.orderBy) {
      const orderByTrim = removeSpecialSymbols(meta.orderBy);

      const field = table ? `${table}.${orderByTrim}` : orderByTrim;
      sorting = ` ORDER BY ${field} ${order}`;
    } else {
      // By default sort by id DESC and created_at DESC if table not null
      if (table) sorting = ` ORDER BY ${table}.id DESC, ${table}.created_at DESC`;
    }
  };

  /**
   * Create order query from orderRaw
   */
  const sortByOrderRaw = () => {
    sorting = ` ${orderRaw}`;
  };

  if (!orderRaw) sortByMetaOrder();
  if (orderRaw) sortByOrderRaw();

  sorting += ' OFFSET :offset LIMIT :perPage';
  bindings = meta?.perPage ? {...bindings, perPage: meta.perPage} : {...bindings, perPage: PER_PAGE};
  bindings = meta?.offset ? {...bindings, offset: meta.offset} : {...bindings, offset: OFFSET};

  return {sorting, bindings};
};

/**
 * Get count of SQL records
 *
 * @param mainQuery {string} SQL query
 * @param bindings {object} SQL bindings for the query
 */
const getCountRecords = async ({mainQuery, bindings}) => {
  const regexpRows = /rows=(\d)+/g;
  const regexpActual = /actual rows=(\d)+/g;
  const countQuery = `EXPLAIN (ANALYZE, TIMING OFF) ${mainQuery}`;

  const countExplain = await DB.query(countQuery, {bindings});

  let count = countExplain[0]['queryPlan'].match(regexpActual);
  count = count[0].match(regexpRows);

  return parseInt(count[0].replace('rows=', ''));
};

/**
 * Prepare SQL query for execution
 *
 * Adding all WHERE conditions to the query
 * Adding all filter conditions to the query
 * Creating all bindings to the query
 * Adding grouping for the query
 * Adding sorting and limit to the query
 * Get the count of query records
 *
 * @param mainQuery {string} the general SQL query
 * @param where {array} of objects with WHERE conditions and bindings ([{ query: 'Condition query string', binding: { key: value } }])
 * @param doNotAddWhere {boolean} if true then doesn't need to add WHERE to the query
 * @param groupBy {string|null} with GROUP BY query (for example: 'GROUP BY data.users.address_id')
 * @param meta {object} meta data (perPage: Int, offset: Int, order: String, orderBy: String). See metaInput type
 * @param orderRaw {string|null} SQL order string, for example:
 *                                 'ORDER BY t.year DESC, t.month DESC, t.week DESC'
 *                               If exist then we will use this data instead meta.order/meta.orderBy/sortingTableName
 * @param sortingTableName {string|null} name of a table with schema for sorting (for example: 'data.users') if meta is used
 * @param filters {object} filter conditions (for example: { userType: "client" })
 * @param filterRules {object} with dictionary for filtering
 *
 * @return {object} - { preparedQuery, bindings, totalCount }
 */
const prepareSQLQuery = async ({
                                 mainQuery,
                                 where,
                                 doNotAddWhere = false,
                                 groupBy = null,
                                 meta = null,
                                 orderRaw = null,
                                 sortingTableName = null,
                                 filters = null,
                                 filterRules = null
                               }) => {
  // Array of objects with conditions in the format: [{ query: 'Condition query string', binding: { key: value } }]
  let whereConditions = where;

  // A general SQL query
  let preparedQuery = mainQuery;

  // If exist filters then add them to conditions
  if (filters) {
    const filterWhere = filtersHelper({filters, rules: filterRules});
    whereConditions = [...whereConditions, ...filterWhere];
  }

  // Create string with conditions and bindings
  const conditionsQuery = createWhereQuery({whereConditions, doNotAddWhere});

  // Add conditions to query
  preparedQuery += conditionsQuery.where;

  // Add grouping
  if (groupBy) preparedQuery += ` ${groupBy}`;

  // Add bindings
  let bindings = conditionsQuery.bindings;

  // Get count of records for the SQL query. Need to call before createMetaQuery
  const totalCount = await getCountRecords({mainQuery: preparedQuery, bindings: conditionsQuery.bindings});

  // Add sorting and limit to query
  const sortingQuery = createMetaQuery(meta, sortingTableName, orderRaw);
  preparedQuery += sortingQuery.sorting;

  // Create bindings for a query
  bindings = {...bindings, ...sortingQuery.bindings};

  return {preparedQuery, bindings, totalCount};
};

export default prepareSQLQuery;
