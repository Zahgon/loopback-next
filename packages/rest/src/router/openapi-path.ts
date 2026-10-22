// Copyright IBM Corp. and LoopBack contributors 2018,2019. All Rights Reserved.
// Node module: @loopback/rest
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

import {stringify, Token, TokenData} from 'path-to-regexp';

/**
 * OpenAPI spec 3.x does not specify the valid forms of path templates.
 *
 * Other ones such as [URI Template](https://tools.ietf.org/html/rfc6570#section-2.3)
 * or [path-to-regexp](https://github.com/pillarjs/path-to-regexp#named-parameters)
 * allows `[A-Za-z0-9_]`
 */
const POSSIBLE_VARNAME_PATTERN = /\{([^\}]+)\}/g;
const VALID_VARNAME_PATTERN = /^[A-Za-z0-9_]+$/;
const NAME_CHAR = /^[A-Za-z0-9_]$/;
const MODIFIERS = ['?', '+', '*'];

/**
 * A piece of a path template as written by an API author. Express-style
 * syntax (`:name`, `(pattern)` and modifiers) is recognized so that it can be
 * rejected with a meaningful message.
 */
type TemplatePart =
  | {kind: 'text'}
  | {kind: 'param'; name: string; pattern: string; modifier: string}
  | {
      kind: 'group';
      prefix: string;
      name: string;
      pattern: string;
      modifier: string;
    };

/**
 * Validate the path to be compatible with OpenAPI path template. No parameter
 * modifier, custom pattern, or unnamed parameter is allowed.
 */
export function validateApiPath(path = '/') {
  for (const part of scanTemplate(path)) {
    if (part.kind === 'text') continue;
    if (part.name !== '') {
      throw new Error(
        `Invalid path template: '${path}'. Please use {${part.name}} instead of ':${part.name}'`,
      );
    }
    if (part.pattern !== '') {
      throw new Error(`Unnamed parameter is not allowed in path '${path}'`);
    }
    if (part.kind === 'group') {
      if (!VALID_VARNAME_PATTERN.test(part.prefix)) {
        throw new Error(
          `Invalid parameter name '${part.prefix}' found in path '${path}'`,
        );
      }
      if (MODIFIERS.includes(part.modifier)) {
        throw new Error(
          `Parameter modifier '{${part.prefix}}${part.modifier}' is not allowed in path '${path}`,
        );
      }
    }
  }
  return path;
}

/**
 * Get all path variables. For example, `/root/{foo}/bar` => `['foo']`
 */
export function getPathVariables(path: string) {
  return path.match(POSSIBLE_VARNAME_PATTERN);
}

/**
 * Parse an OpenAPI path template into path-to-regexp tokens. Every `{var}`
 * becomes a parameter and everything else is literal text, so characters
 * that path-to-regexp reserves for its own syntax keep their plain meaning.
 * @param path - OpenAPI path with optional variables as `{var}`
 */
export function parseApiPath(path: string): TokenData {
  const tokens: Token[] = [];
  let index = 0;
  for (const match of path.matchAll(POSSIBLE_VARNAME_PATTERN)) {
    const start = match.index ?? 0;
    if (start > index) {
      tokens.push({type: 'text', value: path.slice(index, start)});
    }
    tokens.push({type: 'param', name: match[1]});
    index = start + match[0].length;
  }
  if (index < path.length) {
    tokens.push({type: 'text', value: path.slice(index)});
  }
  return new TokenData(tokens, path);
}

/**
 * Convert an OpenAPI path to Express (path-to-regexp) style
 * @param path - OpenAPI path with optional variables as `{var}`
 */
export function toExpressPath(path: string) {
  return stringify(parseApiPath(path));
}

/**
 * Split a path template into the parts `validateApiPath` checks, rejecting
 * malformed Express-style syntax the same way regardless of where it occurs.
 */
function scanTemplate(path: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let i = 0;

  const readName = () => {
    let name = '';
    while (i < path.length && NAME_CHAR.test(path[i])) name += path[i++];
    if (!name) throw new TypeError(`Missing parameter name at ${i}`);
    return name;
  };

  const readPattern = () => {
    if (path[i] !== '(') return '';
    const start = i++;
    let depth = 1;
    let pattern = '';
    if (path[i] === '?') {
      throw new TypeError(`Pattern cannot start with "?" at ${i}`);
    }
    while (i < path.length && depth > 0) {
      const char = path[i];
      if (char === '\\') {
        pattern += char + (path[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (char === ')') depth--;
      else if (char === '(') {
        depth++;
        if (path[i + 1] !== '?') {
          throw new TypeError(`Capturing groups are not allowed at ${i}`);
        }
      }
      if (depth > 0) pattern += char;
      i++;
    }
    if (depth > 0) throw new TypeError(`Unbalanced pattern at ${start}`);
    if (!pattern) throw new TypeError(`Missing pattern at ${start}`);
    return pattern;
  };

  const readModifier = () => (MODIFIERS.includes(path[i]) ? path[i++] : '');

  const readText = () => {
    let text = '';
    while (i < path.length && !'{}():?+*'.includes(path[i])) {
      text += path[i] === '\\' ? (path[++i] ?? '') : path[i];
      i++;
    }
    return text;
  };

  while (i < path.length) {
    const char = path[i];
    if (char === ':' || char === '(') {
      const name = char === ':' ? (i++, readName()) : '';
      const pattern = readPattern();
      if (
        name &&
        !pattern &&
        parts.length &&
        parts[parts.length - 1].kind !== 'text'
      ) {
        throw new TypeError(`Must have text before parameter "${name}"`);
      }
      parts.push({kind: 'param', name, pattern, modifier: readModifier()});
    } else if (char === '{') {
      i++;
      const prefix = readText();
      const name = path[i] === ':' ? (i++, readName()) : '';
      const pattern = readPattern();
      readText();
      if (path[i] !== '}') {
        throw new TypeError(
          `Unexpected ${path[i] ?? 'END'} at ${i}, expected CLOSE`,
        );
      }
      i++;
      parts.push({
        kind: 'group',
        prefix,
        name,
        pattern,
        modifier: readModifier(),
      });
    } else if (char === '}' || MODIFIERS.includes(char)) {
      throw new TypeError(`Unexpected ${char} at ${i}, expected END`);
    } else {
      readText();
      parts.push({kind: 'text'});
    }
  }
  return parts;
}
