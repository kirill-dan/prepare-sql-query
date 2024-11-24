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
const filtersHelper = ({ filters = {}, rules }) => {
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
        binding: { [key]: value }
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
const createWhereQuery = ({ whereConditions, doNotAddWhere = false }) => {
  const conditions = [];
  let bindings = {};
  let where = '';

  whereConditions?.forEach(({ query, binding }) => {
    if (query) conditions.push(`(${query})`);
    if (binding) bindings = { ...bindings, ...binding };
  });

  if (conditions.length) where = conditions?.join(' AND ');

  if (where.length) where = doNotAddWhere ? ` AND ${where}` : ` WHERE ${where}`;

  return { where, bindings };
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
  bindings = meta?.perPage ? { ...bindings, perPage: meta.perPage } : { ...bindings, perPage: PER_PAGE };
  bindings = meta?.offset ? { ...bindings, offset: meta.offset } : { ...bindings, offset: OFFSET };

  return { sorting, bindings };
};

/**
 * Get count of SQL records
 *
 * @param mainQuery {string} SQL query
 * @param bindings {object} SQL bindings for the query
 */
const getCountRecords = async ({ mainQuery, bindings }) => {
  const regexpRows = /rows=(\d)+/g;
  const regexpActual = /actual rows=(\d)+/g;
  const countQuery = `EXPLAIN (ANALYZE, TIMING OFF) ${mainQuery}`;

  const countExplain = await DB.query(countQuery, { bindings });

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
    const filterWhere = filtersHelper({ filters, rules: filterRules });
    whereConditions = [...whereConditions, ...filterWhere];
  }

  // Create string with conditions and bindings
  const conditionsQuery = createWhereQuery({ whereConditions, doNotAddWhere });

  // Add conditions to query
  preparedQuery += conditionsQuery.where;

  // Add grouping
  if (groupBy) preparedQuery += ` ${groupBy}`;

  // Add bindings
  let bindings = conditionsQuery.bindings;

  // Get count of records for the SQL query. Need to call before createMetaQuery
  const totalCount = await getCountRecords({ mainQuery: preparedQuery, bindings: conditionsQuery.bindings });

  // Add sorting and limit to query
  const sortingQuery = createMetaQuery(meta, sortingTableName, orderRaw);
  preparedQuery += sortingQuery.sorting;

  // Create bindings for a query
  bindings = { ...bindings, ...sortingQuery.bindings };

  return { preparedQuery, bindings, totalCount };
};

/**
 * Get all fields from graphQL query or mutation
 *
 * @param info {object} GraphQL info object
 * @return {array} fields data
 */
export const getFieldsFromGraphQl = (info) => {
  // Extract the selection set from the info object
  const selectionSet = info?.fieldNodes?.[0]?.selectionSet;

  // Recursive function to extract fields
  const extractFields = (selectionSet) =>
    selectionSet?.selections
      ?.filter((selection) => selection?.name?.value !== '__typename')
      ?.map((selection) => {
        const name = selection?.name?.value;
        const fields = selection?.selectionSet ? extractFields(selection?.selectionSet) : null;

        return { name, fields };
      });

  // Return the fields from the query
  return extractFields(selectionSet);
};

/**
 * Get another model all related fields from graphQL query or mutation
 *
 * fields - is all fields from graphQl schema
 * relatedFields - is fields with JOIN to another table or SubQuery
 *
 * @param info {object} GraphQL info object
 * @return {{relatedFields: (*|*[]), fields: *}} fields data { fields, relatedFields }
 */
export const getRelatedFieldsFromGraphQl = (info) => {
  const fields = getFieldsFromGraphQl(info);
  const dataFields = fields?.find(({ name }) => name === 'data')?.fields || [];
  const relatedDataFields = dataFields?.filter(({ fields }) => fields?.length > 0) || [];
  const relatedFields = {};

  for (const relateField of relatedDataFields) {
    relatedFields[relateField.name] = relateField.fields?.map((item) => item.name) || [];
  }

  return { fields: dataFields?.map(({ name }) => name), relatedFields };
};

/**
 * Create a SQL query for the Builder
 *
 * @param mainQuery {string} the general SQL query
 * @param where {array} of objects with WHERE conditions and bindings ([{ query: 'Condition query string', binding: { key: value } }])
 *
 * @return {object} - { preparedQuery, bindings }
 */
export const createSqlQueryForBuilder = ({ mainQuery, where }) => {
  // A general SQL query
  let preparedQuery = mainQuery;

  // Create string with conditions and bindings
  const conditionsQuery = createWhereQuery({ whereConditions: where });

  // Add conditions to query
  preparedQuery += conditionsQuery.where;

  // Add bindings
  const bindings = conditionsQuery.bindings;

  return { preparedQuery, bindings };
};

/**
 * PostgreSQL query builder
 *
 * Builds a data structure for generating SQL queries
 * The return format corresponds to the `prepareSQLQuery` function from the 'prepare-sql-query' package
 *
 * @param {object} modelSQLField - Contains model SQL fields, including table name and query configurations
 * @param {array} fieldsData - An array of field names to include in the query
 * @param {object} relatedFieldsData - Fields that related with other models (have other fields that needs to get from related model)
 * @param info {object} GraphQL info object. By default is null. If you use this arg, you can skip fieldsData and relatedFieldsData
 *
 * @return {object} An object containing data for creating the SQL query:
 * {
 *   where: [{ query: string, binding: object }],
 *   mainQuery
 * }
 *
 * @property {array} where - An array of objects, each representing a WHERE condition query and its associated bindings for placeholders
 * @property {string} mainQuery - A string representing the base query, constructed using `modelSQLField.tableName` with the selected fields and join queries
 *
 * modelSQLField has to be the next format:
 *
 *   export const feedbackSQLFields = {
 *     tableName: 'data.feedbacks f',
 *     id: { select: ['f.id'] },
 *     score: { select: ['f.score'] },
 *     message: { select: ['f.message'] },
 *     images: { select: ['f.images'] },
 *     authorId: { select: ['f.author_id'] },
 *     author: { relation: userSQLFields, type: {}, where: { query: 'u.id = f.author_id' } },
 *     answers: { select: ['f.answers'] },
 *     createdAt: { select: ['f.created_at'] },
 *     updatedAt: { select: ['f.updated_at'] }
 *   };
 *
 *   OR
 *
 *   export const userSQLFields = {
 *     tableName: 'data.users u',
 *     id: { select: ['DISTINCT u.id'] },
 *     avatar: { select: ['u.avatar'] },
 *     firstName: { select: ['u.first_name'] },
 *     lastName: { select: ['u.last_name'] },
 *     address: {
 *       select: ['to_jsonb(a) as address'],
 *       join: ['INNER JOIN data.addresses a ON a.id = u.address_id'],
 *       where: { query: 'a.id = u.address_id', binding: {} }
 *     },
 *     currency: {
 *       select: ['COALESCE(uset.currency, :defaultPlatformCurrency) as currency'],
 *       join: ['INNER JOIN data.user_settings uset ON uset.user_id = u.id'],
 *       where: {
 *         binding: { defaultPlatformCurrency: DEFAULT_PLATFORM_CURRENCY }
 *       }
 *     },
 *     locale: {
 *       select: ['COALESCE(uset.locale, :defaultLanguage) as locale'],
 *       join: ['LEFT JOIN data.user_settings uset ON uset.user_id = u.id'],
 *       where: {
 *         binding: { defaultLanguage }
 *       }
 *     },
 *     favorites: {
 *       select: [
 *         `(SELECT jsonb_agg(uf)
 *                  FROM data.users uf
 *                  INNER JOIN data.client_favorites cf ON uf.id = ANY (cf.service_providers)
 *                  WHERE cf.client_id = u.id) AS favorites`
 *       ]
 *     },
 *     unreadMessages: {
 *       select: [
 *         `(SELECT count(pc.id) as unread_messages FROM data.private_chats pc
 *           WHERE pc.author_id = u.id AND pc.read = false) AS unread_messages`
 *       ]
 *     },
 *   };
 *
 *  * Fields for creating an SQL query (necessary for retrieving multiple records in a single SQL query, avoiding the N+1 problem)
 *  *
 *  *   Fields format:
 *  *   {
 *  *     tableName: 'data.users u',
 *  *     address: {
 *  *       select: ['to_jsonb(a) as address'],
 *  *       join: ['INNER JOIN data.addresses a ON a.id = u.address_id'],
 *  *       where: { query: 'a.id = u.address_id AND u.id = :userId', binding: { userId: 1 } }
 *  *     }
 *  *
 *  *     !!! If the field is related to another model, use the following format:
 *  *       author: {
 *  *                 relation: userSQLFields,
 *  *                 type: {} OR [] (to indicate an array or object for subQuery),
 *  *                 where: { query: 'f.author_id = u.id' } condition for the subQuery (defines the relationship between this model and the subQuery)
 *  *               }
 *  *     !!!
 *  *   }
 *
 *    FIELDS DATA DOC:
 *      tableName - The table name with its schema and alias
 *      key of object - The field name that needs to be attached to the query
 *      object within the key:
 *        select - An array of fields to be included in the SELECT section of the query (with aliases and using the table alias)
 *        join - An array of joins to be included in the query, which will be placed after the FROM clause
 *        where - An object containing two keys
 *                 - query: A string with conditions to be used in the WHERE clause
 *                 - binding: An object with key-value bindings, where the key represents a placeholder and the value is the binding
 *        relation - An object representing another model from which a subquery will be created. If this key is used, the `where` condition will apply to the subQuery
 *        type - An empty object (`{}`) or array (`[]`) used only with the `relation` key.
 *               This indicates whether the subquery should return one object (`{}`) or multiple objects (`[]`)
 *
 */
export const postgreSqlBuilder = ({ modelSQLField = null, fieldsData = [], relatedFieldsData = {}, info = null }) => {
  if (!modelSQLField) throw new Error('Invalid input: modelSQLField is required');
  if (!fieldsData?.length && !info) throw new Error('Invalid input: fields or info are required (fields must be an array, info - object)');

  let fields = fieldsData;
  let relatedFields = relatedFieldsData;

  // If needs to get fields from graphQl schema
  if (info) {
    const fieldsFromGraphQl = getRelatedFieldsFromGraphQl(info);
    fields = fieldsFromGraphQl.fields;
    relatedFields = fieldsFromGraphQl.relatedFields;
  }

  const select = new Set();
  const join = new Set();
  const whereQuery = new Set();
  const whereBindings = new Set();

  // Try to get all SQL queries schema for every field
  for (const field of fields) {
    const modelField = modelSQLField?.[field];

    // Check if this field is related to another model (use fields from the related model)
    if (relatedFields?.[field]?.length && modelField?.relation) {
      // Retrieve the related model schema
      const relatedModelSQLField = modelField?.relation;

      // Determine the type for this model, needed to understand what kind of subQuery to create
      const typeForRelatedField = modelField?.type;

      // Determine the condition for this model, required to define the subQuery condition
      const whereForRelatedField = modelField?.where;

      // Retrieve the fields for this schema
      const fieldsForRelatedField = relatedFields?.[field];

      // Create a query for the related model schema (relatedModelSQLField)
      const relatedBuilderData = postgreSqlBuilder({ modelSQLField: relatedModelSQLField, fieldsData: fieldsForRelatedField });

      // Add the condition for this data
      relatedBuilderData?.where?.push(whereForRelatedField);

      // Create full query in the simple SQL builder (het SQL and bindings)
      const subQueryData = createSqlQueryForBuilder({ ...relatedBuilderData });

      // Get prepared subQuery
      let subQuery = subQueryData.preparedQuery;

      // Check type for the subQuery and add the correct wrapper (Array)
      if (Array.isArray(typeForRelatedField)) {
        subQuery = `(SELECT jsonb_agg(${field}_alias) FROM (${subQuery}) AS ${field}_alias) AS ${field}`;
      }

      // Check type for the subQuery and add the correct wrapper (Object)
      if (typeForRelatedField.constructor === Object) {
        subQuery = `(SELECT to_jsonb(${field}_alias) FROM (${subQuery}) AS ${field}_alias) AS ${field}`;
      }

      // Add this subQuery to select
      select.add(subQuery);

      // Add bindings of subQuery. Transform to a string before adding to the Set
      for (const [key, value] of Object.entries(subQueryData.bindings)) {
        // Transform to a string before adding to the Set
        whereBindings.add(JSON.stringify({ [key]: value }));
      }

      // Break this loop
      continue;
    }

    if (modelField?.select?.length) select.add(modelField?.select);
    if (modelField?.join?.length) join.add(modelField?.join);
    if (modelField?.where?.query) whereQuery.add(modelField?.where?.query);

    // Create the whereBindings object with all bindings
    if (modelField?.where?.binding) {
      for (const [key, value] of Object.entries(modelField.where.binding)) {
        // Transform to a string before adding to the Set
        whereBindings.add(JSON.stringify({ [key]: value }));
      }
    }
  }

  // Convert Set to array
  const whereData = {
    query: [...whereQuery],
    bindings: [...whereBindings]?.map((item) => JSON.parse(item))
  };

  // Create the correct format for queries and bindings
  const queries = whereData?.query?.map((item) => ({ query: item })) || [];
  const bindings = whereData?.bindings?.reduce((acc, item) => ({ ...acc, ...item }), {}) || {};

  // Transform arrays to string data
  const data = { where: [...queries], select: [...select]?.join(',\n'), join: [...join]?.join('\n') };

  if (Object.keys(bindings)?.length) data.where.push({ binding: bindings });

  data.mainQuery = `SELECT ${data.select} FROM ${modelSQLField?.tableName} ${data.join}`;

  return { mainQuery: data.mainQuery, where: data.where };
};

export default prepareSQLQuery;
