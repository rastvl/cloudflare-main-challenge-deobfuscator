const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');
const vm = require('node:vm');

const {
  MAIN_ARRAY_NAME,
  SHUFFLE_ARRAY_FUNCTION_ARGS_LENGTH,
} = require('./utils/constants');

var console_log = console.log;
let counter = 1;
console.log = function (args) {
  console_log.apply(this, arguments);
  console_log(
    '==========================================================================================================================',
    counter
  );
  ++counter;
};

class Deobfuscator {
  constructor(sourceCode) {
    this._code = sourceCode;
    this._ast = parser.parse(sourceCode);
    this._mainArray = [];
  }

  deobfuscate() {
    this._replaceStrings();

    this._replaceProxyFunctions();
    this._replaceProxyFunctions();

    this._replaceObjectConstants();
    this._replaceObjectConstants();

    this._transformLogicalBranches();

    return generate(this._ast).code;
  }

  _getMainArray() {
    traverse(this._ast, {
      AssignmentExpression: (path) => {
        const { node } = path;
        if (
          t.isMemberExpression(node.left) &&
          node.left.property.name === MAIN_ARRAY_NAME
        ) {
          const elementsArray = t.arrayExpression(node.right.elements).elements;

          elementsArray.forEach((el) => {
            this._mainArray.push(el.value);
          });

          path.stop();
        }
      },
    });
  }

  _replaceStrings() {
    if (this._mainArray.length === 0) {
      this._getMainArray();
    }

    traverse(this._ast, {
      MemberExpression: (path) => {
        const { node } = path;

        if (
          node.object.name === MAIN_ARRAY_NAME &&
          t.isNumericLiteral(node.property)
        ) {
          path.replaceWith(
            t.stringLiteral(this._mainArray[node.property.value])
          );
        }
      },
    });
    this._replaceInnerString();
  }

  static _getFirstBindingAssignment(binding) {
    let scope = binding.scope;
    let resultPath;

    traverse(
      scope.block,
      {
        AssignmentExpression: (path) => {
          const { node } = path;

          if (
            t.isIdentifier(node.left) &&
            node.left.name === binding.identifier.name
          ) {
            resultPath = path;
            path.stop();
          }
        },
      },
      scope,
      scope.path.parent
    );

    return resultPath;
  }

  _getInnerArray(path, scopeData) {
    path.scope.traverse(path.scope.block, {
      CallExpression: (path_) => {
        const node_ = path_.node;
        if (
          node_.callee &&
          t.isMemberExpression(node_.callee) &&
          !node_.callee.computed &&
          t.isStringLiteral(node_.callee.object) &&
          t.isIdentifier(node_.callee.property) &&
          node_.callee.property.name === 'split'
        ) {
          const delimiter = node_.arguments[0].value;
          scopeData.array = node_.callee.object.value.split(delimiter);
          path_.stop();
        }
      },
    });
  }

  _shuffleInnerArray(path, arrayIdentifierName, scopeData) {
    let shuffleIndex;
    path.scope.traverse(path.scope.block, {
      CallExpression: (path_) => {
        const node_ = path_.node;

        if (
          node_.arguments.length === SHUFFLE_ARRAY_FUNCTION_ARGS_LENGTH &&
          t.isNumericLiteral(node_.arguments[1]) &&
          t.isIdentifier(node_.arguments[0]) &&
          node_.arguments[0].name === arrayIdentifierName
        ) {
          shuffleIndex = node_.arguments[1].value + 1;

          // ShuffleArray
          for (; --shuffleIndex; scopeData.array.push(scopeData.array.shift()));
        }
      },
    });
  }

  _replaceInnerString() {
    const scopeIdToArray = new Map();

    traverse(this._ast, {
      CallExpression: (path) => {
        const { node } = path;
        if (
          node.arguments.length === 1 &&
          t.isStringLiteral(node.arguments[0]) &&
          node.arguments[0].value.startsWith('0x')
        ) {
          // There is no explicit reference to the original array in the script.
          // Instead, it refers to a function that returns the array element by index,
          // applying some offset (default is 0). We first need to find this function,
          // then figure out what array it works with, take that array, shuffle it,
          // and only then replace all the strings
          if (scopeIdToArray.has(path.scope.uid)) {
            const scopeData = scopeIdToArray.get(path.scope.uid);
            path.replaceWith(
              t.stringLiteral(
                scopeData.getString(parseInt(node.arguments[0].value, 16))
              )
            );
          }

          // Get the function name
          const bindingFunctionName = node.callee.name;

          // Finding a binding of "getStringFromArray" function
          const bindingFunctionScope = path.scope;
          const bindingFunction =
            bindingFunctionScope.getBinding(bindingFunctionName);

          // Get the path of assigned function
          const bindingAssignmentPath =
            Deobfuscator._getFirstBindingAssignment(bindingFunction);

          // Get the array identifier name
          let arrayIdentifierName;
          bindingAssignmentPath.scope.traverse(bindingAssignmentPath.node, {
            MemberExpression: (path_) => {
              arrayIdentifierName = path_.node.object.name;
            },
          });

          // TODO: Get array index offset. Default = 0

          const scopeData = {
            array: [],
            arrayIndexOffset: 0,
            getString(index) {
              return this.array[index + this.arrayIndexOffset];
            },
          };

          // Need to find the string and the delimiter.
          // All this is in the scope along with bindingAssignmentPath
          this._getInnerArray(bindingAssignmentPath, scopeData);

          // We need to shuffle our array
          // To do this we need to find the shuffle index
          this._shuffleInnerArray(
            bindingAssignmentPath,
            arrayIdentifierName,
            scopeData
          );

          scopeIdToArray.set(path.scope.uid, scopeData);
          path.replaceWith(
            t.stringLiteral(
              scopeData.getString(parseInt(node.arguments[0].value, 16))
            )
          );
        }
      },
    });
  }

  _replaceProxyFunctions() {
    const scopeIdToBinaryOpPath = {};

    traverse(this._ast, {
      AssignmentExpression: (path) => {
        const { node } = path;

        // Proxy function
        if (
          t.isFunctionExpression(node.right) &&
          t.isMemberExpression(node.left) &&
          (node.left.property.value || node.left.property.name) &&
          node.right.body.body.length === 1 &&
          t.isReturnStatement(node.right.body.body[0]) &&
          (t.isBinaryExpression(node.right.body.body[0].argument) ||
            t.isCallExpression(node.right.body.body[0].argument))
        ) {
          // We find proxy function and fill in scopeIdToBinaryOpPath(scopeUID -> Map<key, pathToBinaryNode>).
          // Key is created using the ID name and the property value(n['xyz'] = function ... -> key = n_xyz).
          // In this way we get a structure where each scope is mapped to a bindings.
          // In the next traversal, if we come across the use of the proxy function,
          // we will be able to get the right node by key to know which binary operator is being used.

          const proxyFnIdentifier = node.left.object.name;
          const proxyFnBinding = path.scope.getBinding(proxyFnIdentifier);

          const key = `${node.left.object.name}_${
            node.left.property.value || node.left.property.name
          }`;

          if (scopeIdToBinaryOpPath[proxyFnBinding.scope.uid]) {
            scopeIdToBinaryOpPath[proxyFnBinding.scope.uid].set(
              key,
              node.right.body.body[0].argument
            );
          } else {
            scopeIdToBinaryOpPath[proxyFnBinding.scope.uid] = new Map();
            scopeIdToBinaryOpPath[proxyFnBinding.scope.uid].set(
              key,
              node.right.body.body[0].argument
            );
          }

          // Cloudflare does something like that:
          // m['xyz'] = function ... ;
          // n = m;
          // n['xyz'](a, b)
          // So we need to find all the assignments and fill them with the right keys
          proxyFnBinding.referencePaths.forEach((refPath) => {
            if (
              t.isAssignmentExpression(refPath.parentPath.node) &&
              t.isIdentifier(refPath.parentPath.node.left)
            ) {
              const refBinding = refPath.scope.getBinding(
                refPath.parentPath.node.left.name
              );
              const key = `${refPath.parentPath.node.left.name}_${
                node.left.property.value || node.left.property.name
              }`;

              scopeIdToBinaryOpPath[refBinding.scope.uid].set(
                key,
                node.right.body.body[0].argument
              );
            }
          });
        }
      },
    });

    traverse(this._ast, {
      CallExpression: (path) => {
        const { node } = path;

        if (!t.isMemberExpression(node.callee)) return;

        const bindingName = node.callee.object.name || node.callee.object.value;
        const binding = path.scope.getBinding(bindingName);
        if (!binding) return;

        const bindingScopeId = binding.scope.uid;
        if (!bindingScopeId || !scopeIdToBinaryOpPath[bindingScopeId]) return;

        const bindingPropName =
          node.callee.property.value || node.callee.property.name;
        const key = `${bindingName}_${bindingPropName}`;

        const binaryOpPath = scopeIdToBinaryOpPath[bindingScopeId].get(key);

        if (t.isBinaryExpression(binaryOpPath)) {
          path.replaceWith(
            t.binaryExpression(
              binaryOpPath.operator,
              node.arguments[0],
              node.arguments[1]
            )
          );
        } /* else if (t.isCallExpression(binaryOpPath)) {
          // TODO: simplify function calls
          // path.replaceWith(
          //   t.CallExpression(node.arguments[0], [
          //     ...node.arguments.filter((el, ix) => ix != 0),
          //   ])
          // );
        } */
      },
    });
  }

  _replaceObjectConstants() {
    const scopeIdToConstants = {};

    traverse(this._ast, {
      AssignmentExpression: (path) => {
        const { node } = path;

        if (
          t.isMemberExpression(node.left) &&
          t.isLiteral(node.right) &&
          node.left.object
        ) {
          const constantIdentifier = node.left.object.name;
          if (!constantIdentifier) return;

          const constantBinding = path.scope.getBinding(constantIdentifier);
          if (!constantBinding) return;

          const key = `${node.left.object.name}_${
            node.left.property.value || node.left.property.name
          }`;

          if (scopeIdToConstants[constantBinding.scope.uid]) {
            scopeIdToConstants[constantBinding.scope.uid].set(
              key,
              node.right.value
            );
          } else {
            scopeIdToConstants[constantBinding.scope.uid] = new Map();
            scopeIdToConstants[constantBinding.scope.uid].set(
              key,
              node.right.value
            );
          }

          constantBinding.referencePaths.forEach((refPath) => {
            if (
              t.isAssignmentExpression(refPath.parentPath.node) &&
              t.isIdentifier(refPath.parentPath.node.left)
            ) {
              const refBinding = refPath.scope.getBinding(
                refPath.parentPath.node.left.name
              );
              const key = `${refPath.parentPath.node.left.name}_${
                node.left.property.value || node.left.property.name
              }`;

              scopeIdToConstants[refBinding.scope.uid].set(
                key,
                node.right.value
              );
            }
          });
        }
      },
    });

    traverse(this._ast, {
      MemberExpression: (path) => {
        const { node } = path;

        // Can't replace lvalue
        if (
          t.isAssignmentExpression(path.parentPath.node) &&
          path.parentPath.node.left === node
        ) {
          return;
        }

        if (!node.object) return;

        const bindingName = node.object.name;
        if (!bindingName) return;

        const binding = path.scope.getBinding(bindingName);
        if (!binding) return;

        const bindingScopeId = binding.scope.uid;
        if (!bindingScopeId || !scopeIdToConstants[bindingScopeId]) return;

        const bindingPropName = node.property.value || node.property.name;
        const key = `${bindingName}_${bindingPropName}`;

        const constantValue = scopeIdToConstants[bindingScopeId].get(key);
        if (!constantValue) return;

        switch (typeof constantValue) {
          case 'string':
            path.replaceWith(t.stringLiteral(constantValue));
            break;
          case 'number':
            path.replaceWith(t.numericLiteral(constantValue));
            break;
          default:
            break;
        }
      },
    });
  }

  _transformLogicalBranches() {
    traverse(this._ast, {
      'ConditionalExpression|IfStatement': (path) => {
        const { node } = path;
        let { consequent } = node;
        let { alternate } = node;

        let testNodePath = path.get('test');
        const testNodeResult = testNodePath.evaluateTruthy();

        if (testNodeResult === undefined) return;

        if (testNodeResult === true) {
          if (t.isBlockStatement(consequent)) {
            consequent = consequent.body;
          }
          path.replaceWithMultiple(consequent);
        } else {
          if (alternate != null) {
            if (t.isBlockStatement(alternate)) {
              alternate = alternate.body;
            }
            path.replaceWithMultiple(alternate);
          } else {
            path.remove();
          }
        }
      },
    });
  }
}

module.exports = Deobfuscator;
