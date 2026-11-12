'use strict';

const { tokenize } = require('./tokenizer');

/**
 * XS Classic design-time files such as .hdbtable, .hdbview, .hdbsequence use a
 * `key = value;` syntax (table.schemaName = "X"; schema = "X"; ...) instead of SQL,
 * while the same extensions contain plain SQL DDL in HDI projects.
 * The SQL formatter must leave the former alone.
 */
function isKeyValueArtifact(text) {
  // `//` comments are valid in XS Classic files but unknown to the SQL tokenizer
  const tokens = tokenize(text.replace(/^[ \t]*\/\/.*$/gm, ''));
  let i = tokens.findIndex((t) => t.type !== 'lineComment' && t.type !== 'blockComment');
  if (i < 0 || tokens[i].type !== 'word') return false;
  i++;
  while (tokens[i] && tokens[i].text === '.' && tokens[i + 1] && tokens[i + 1].type === 'word') i += 2;
  return !!tokens[i] && tokens[i].text === '=';
}

module.exports = { isKeyValueArtifact };
