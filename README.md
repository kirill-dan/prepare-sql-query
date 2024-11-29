# prepare-sql-query
### Node.js solution for building a complex and flexible PostgreSQL query

#### Allows creating flexible and powerful GraphQL queries as a single query, avoiding the N+1 problem in the SQL Builder.  
#### Supports using custom API fields to automatically generate a single PostgreSQL query in auto mode.

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
    filterRules: FILTER_WITH_TABLES,
    rawTotalCountQuery: search || Object.keys(filters)?.length ? null : { query: 'SELECT COUNT(a.id) FROM data.articles a;' }
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

@param getTotalCount {boolean} get total count records in the DB (by default = true)

@param {object|null} rawTotalCountQuery - RAW query for the total count of records
                                          Useful for showing all data (default is `null`)
                                          If provided, the `getCountRecords` function will be ignored
                                          If `getTotalCount` is `false`, this RAW query will be ignored
                                          Example: {
                                                     query: 'SELECT count(u.id) as count FROM data.users u WHERE u.type = :serviceProvider',
                                                     bindings: { serviceProvider: 'serviceProvider' },
                                                     countField: 'count'
                                                   }

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


# PostgreSQL Query Builder

## Overview

The `postgreSqlBuilder` function simplifies the creation of SQL queries for PostgreSQL. It generates a flexible data structure that can be used to construct powerful queries while avoiding the N+1 problem. This function is particularly useful in GraphQL applications where efficient query handling is essential.

## Features

- **Flexible Query Building**: Supports dynamic SQL field configurations
- **GraphQL Integration**: Automatically determines required fields using the GraphQL `info` object
- **Avoids N+1 Problem**: Efficiently retrieves related data in a single SQL query
- **Customizable Relations**: Handles complex relationships between models

## Function Signature

```javascript
postgreSqlBuilder({
  modelSQLField = null,
  fieldsData = [],
  relatedFieldsData = {},
  info = null,
});
```

## Parameters

- **modelSQLField** (object): Contains SQL field definitions for the main model, including the table name and configurations for fields and relations
- **fieldsData** (array): An array of field names to include in the query
- **relatedFieldsData** (object): Specifies fields related to other models, including additional fields to retrieve
- **info** (object, optional): A GraphQL info object. When provided, `fieldsData` and `relatedFieldsData` are automatically derived from `info`

## Returns

The function returns an object with the following structure:

```javascript
{
  where: [{ query: string, binding: object }],
  mainQuery: string
}
```

- **where** (array): Represents WHERE conditions with their SQL query strings and associated bindings for placeholders
- **mainQuery** (string): The main SQL query string, including selected fields, joins, and conditions

## Example: Defining `modelSQLField`
The `modelSQLField` object must be defined in a specific format to ensure compatibility. Below are examples of how to set it up for different use cases.

### Feedback Model
```javascript
export const feedbackSQLFields = {
  tableName: 'data.feedbacks f',
  id: { select: ['f.id'] },
  score: { select: ['f.score'] },
  message: { select: ['f.message'] },
  images: { select: ['f.images'] },
  authorId: { select: ['f.author_id'] },
  author: {
    relation: userSQLFields,
    type: {},
    where: { query: 'u.id = f.author_id' },
  },
  answers: { select: ['f.answers'] },
  createdAt: { select: ['f.created_at'] },
  updatedAt: { select: ['f.updated_at'] },
};
```

### User Model
```javascript
export const userSQLFields = {
  tableName: 'data.users u',
  id: { select: ['DISTINCT u.id'] },
  avatar: { select: ['u.avatar'] },
  firstName: { select: ['u.first_name'] },
  lastName: { select: ['u.last_name'] },
  address: {
    select: ['to_jsonb(a) as address'],
    join: ['INNER JOIN data.addresses a ON a.id = u.address_id']
  },
  currency: {
    select: ['COALESCE(uset.currency, :defaultPlatformCurrency) as currency'],
    join: ['INNER JOIN data.user_settings uset ON uset.user_id = u.id'],
    where: {
      binding: { defaultPlatformCurrency: DEFAULT_PLATFORM_CURRENCY },
    },
  },
  locale: {
    select: ['COALESCE(uset.locale, :defaultLanguage) as locale'],
    join: ['LEFT JOIN data.user_settings uset ON uset.user_id = u.id'],
    where: {
      binding: { defaultLanguage },
    },
  },
  favorites: {
    select: [
      `(SELECT jsonb_agg(uf)
               FROM data.users uf
               INNER JOIN data.client_favorites cf ON uf.id = ANY (cf.service_providers)
               WHERE cf.client_id = u.id) AS favorites`,
    ],
  },
  unreadMessages: {
    select: [
      `(SELECT count(pc.id) as unread_messages FROM data.private_chats pc
        WHERE pc.author_id = u.id AND pc.read = false) AS unread_messages`,
    ],
  },
};
```

## Notes on Relationships
If a field is related to another model, it must use the following structure:

```javascript
author: {
  relation: userSQLFields,
  type: {} OR [], // Indicates if the subQuery returns an object or array
  where: { query: 'f.author_id = u.id' }, // Condition for this subQuery (defines the relationship between this model and the subQuery)
}
````

## Example for Related Field
```javascript
export const exampleSQLFields = {
  tableName: 'data.example_table e',
  id: { select: ['e.id'] },
  author: {
    relation: userSQLFields,
    type: {},
    where: { query: 'e.author_id = u.id' },
  },
};
```

## Fields Data Documentation

- **tableName**: The table name with its schema and alias.
- **Key of object**: The field name that needs to be attached to the query.
- **Object within the key**:
    - **select**: An array of fields to be included in the `SELECT` section of the query (with aliases and using the table alias).
    - **join**: An array of joins to be included in the query, which will be placed after the `FROM` clause.
    - **where**: An object containing two keys:
        - `query`: A string with conditions to be used in the `WHERE` clause.
        - `binding`: An object with key-value bindings, where the key represents a placeholder and the value is the binding.
    - **relation**: An object representing another model from which a subquery will be created. If this key is used, the `where` condition will apply to the subquery.
    - **type**: An empty object (`{}`) or array (`[]`) used only with the `relation` key. This indicates whether the subquery should return one object (`{}`) or multiple objects (`[]`).

## Benefits

Using this query builder ensures efficient database querying by:

- **Generating** SQL queries dynamically based on your data structure
- **Minimizing** the number of database calls
- **Supporting** complex relationships between models with ease

### GraphQL resolver example:

```javascript
/**
 * Get model
 *
 * @param authorId {integer} - show review for a specific user
 * @param meta {object} for sorting and pagination
 * @param info {object} GraphQL info object
 */
const dataWithSearch = async ({ authorId, meta, info }) => {
    const sqlBuilder = postgreSqlBuilder({ modelSQLField: feedbackSQLFields, info });

    // Array of objects with conditions in the format: [{ query: 'Condition query string', binding: { key: value } }]
    const where = sqlBuilder.where || [];

    // A main query for the resolver
    const mainQuery = sqlBuilder.mainQuery;

    if (authorId) where.push({ query: 'f.author_id = :authorId', binding: { authorId } });

    // Preparing query (add conditions, bindings)
    const query = await prepareSQLQuery({
      mainQuery,
      where,
      meta,
      sortingTableName: 'f',
      filterRules: FILTER_WITH_TABLES
    });

    if (query.totalCount === 0) return { data: [], totalCount: query.totalCount };

    const data = await DB.query(query.preparedQuery, { bindings: query.bindings });

    return { data, totalCount: query.totalCount };
  };
```
