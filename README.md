# prepare-sql-query
Node.js solution for building a complex and flexible PostgreSQL query

### Installation
**npm**: npm install prepare-sql-query  
**yarn**: yarn add prepare-sql-query

### The reason for this solution
It is necessary to retrieve data with various conditions provided from the frontend, such as filtering by criteria, searching, sorting, limiting, pagination, and other conditions.   
It is very useful for using with REST API or graphQL in a controller

### Query with filters and search

To create filters and perform searches, the data needs to be formatted correctly. See the example:
```javascript
import prepareSQLQuery, { removeSpecialSymbols } from 'prepare-sql-query';

// Association field type with db table (needs for correct filtering)
const FILTER_WITH_TABLES = {
  month: {
    table: 'data.articles',
    field: 'created_at',
    query: 'EXTRACT(MONTH FROM data.articles.created_at) = :value'
  },
  year: {
    table: 'data.articles',
    field: 'created_at',
    query: 'EXTRACT(YEAR FROM data.articles.created_at) = :value'
  },
  isPublished: {
    table: 'data.articles',
    field: 'is_published',
    query: null
  }
};

/**
 * Show all data
 */
const showAllData = async ({ meta, search, filters }) => {
  // Addition condition for search
  const { data, totalCount } = await dataWithSearch({ search, filters, meta });

  return {
    totalCount,
    data
  };
};

/**
 * Get model with search data and filtering
 *
 * @param search {string} for search
 * @param filters {object} for filtering { field: value } Needs to use FILTER_WITH_TABLES dict
 * @param meta {object} for sorting and pagination
 * @return {Promise}
 */
const dataWithSearch = async ({ search, filters, meta }) => {
  // Array of objects with conditions in the format: [{ query: 'Condition query string', binding: { key: value } }]
  const where = [];

  // A main query for the resolver
  const mainQuery = 'SELECT data.articles.* FROM data.articles';

  // If a search exists, create an additional query with the necessary fields for searching
  if (search) {
    where.push({
      query: `(substring(data.articles.id::varchar from '^' || :search || '(.*)$') IS NOT NULL OR
               substring(LOWER(data.articles.title) from '^' || :search || '(.*)$') IS NOT NULL OR
               substring(LOWER(data.articles.slug) from '.*' || :search || '(.*)$') IS NOT NULL OR
               substring(to_char(data.articles.created_at, 'DD/MM/YYYY') from '^' || :search || '(.*)$') IS NOT NULL)`,
      binding: { search: removeSpecialSymbols(search.toLowerCase()) }
    });
  }

  // Preparing query (add conditions, bindings)
  const query = await prepareSQLQuery({
    mainQuery,
    where,
    meta,
    sortingTableName: 'data.articles',
    filters,
    filterRules: FILTER_WITH_TABLES
  });

  if (query.totalCount === 0) return { data: [], totalCount: query.totalCount };

  // Now we can call the prepared SQL query with the help of Sequelize for example
  const data = await sequelize.query(query.preparedQuery, {
    model: models.article, // Article Sequelize model. In this example, it is used together with GraphQL
    mapToModel: true,
    replacements: query.bindings
  });

  return { data, totalCount: query.totalCount };
};
```

### Function params:
```
@param mainQuery {string} the general SQL query  
  Example: 'SELECT data.articles.* FROM data.articles'
  
@param where {array} of objects with WHERE conditions and bindings ([{ query: 'Condition query string', binding: { key: value } }])  
  Example: [{ query: 'data.articles.user_id = :userId', binding: { userId: 5 } }]
  
@param doNotAddWhere {boolean} if true then doesn't need to add WHERE to the query
  If you want to use a complex query that includes a WHERE, set doNotAddWhere to true
  
  Example: "SELECT data.articles.* FROM data.articles WHERE data.articles.additional ->> 'authorName' = :authorName"
  
  This means that all WHERE conditions will be added to the current query using AND
  Don't forget to set the bindings: [{ binding: { authorName: 'Joe' } }]
  
@param groupBy {string|null} with GROUP BY query (for example: 'GROUP BY data.articles.is_published')
  Example: 'GROUP BY data.articles.year, data.articles.month';
  
@param meta {object} meta data (perPage: Int, offset: Int, order: String, orderBy: String), 
  by default { perPage: 25, offset: 0, order: 'ASC', orderBy: By default sort by id DESC and created_at DESC if table not null }
  
@param orderRaw {string|null} SQL order string, for example:
                                'ORDER BY t.year DESC, t.month DESC, t.week DESC'
                              If exist then we will use this data instead meta.order/meta.orderBy/sortingTableName
                              
@param sortingTableName {string|null} name of a table with schema for sorting (for example: 'data.articles') if meta is used

@param filters {object} filter conditions (for example: { isPublished: true })

@param filterRules {object} with dictionary for filtering, in our case, it is FILTER_WITH_TABLES

@return {object} - { preparedQuery, bindings, totalCount }
```

### FILTER_WITH_TABLES structure:
For example:
```
const FILTER_WITH_TABLES = {
  month: {
    table: 'data.articles',
    field: 'created_at',
    query: 'EXTRACT(MONTH FROM data.articles.created_at) = :value'
  },
  year: {
    table: 'data.articles',
    field: 'created_at',
    query: 'EXTRACT(YEAR FROM data.articles.created_at) = :value'
  },
  isPublished: {
    table: 'data.articles',
    field: 'is_published',
    query: null
  }
};
```
**Where:**  
keys of object - have to be equal of keys from a frontend filters   
table - a table name with schema.   
field - a field name for a condition (will be used condition field = :value from the corresponding the filters key)
query - an additional query. If it is not null, the field value will be ignored, and only this query will be used
