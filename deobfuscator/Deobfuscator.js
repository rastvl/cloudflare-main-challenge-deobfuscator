const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

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
    // this._replaceStrings();
  }

  deobfuscate() {
    this._replaceStrings();
    this._test();
    this._getProxyFunctions();
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
    // const a = performance.now();

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
    // console.log(performance.now() - a);
  }

  _getProxyFunctions() {
    const a = performance.now();
    const scopeIdToBinaryOpPath = {};
    // const keyToBinding = new Map();
    traverse(this._ast, {
      AssignmentExpression: (path) => {
        const { node } = path;

        // Proxy function
        if (
          t.isFunctionExpression(node.right) &&
          t.isMemberExpression(node.left) &&
          node.left.property.value && // <<<<<<<<<<<< надо чето сделать. Заменить шоле там ниже. Может св-во через точку прописано
          node.right.body.body.length === 1 &&
          t.isReturnStatement(node.right.body.body[0]) &&
          (t.isBinaryExpression(node.right.body.body[0].argument) ||
            t.isCallExpression(node.right.body.body[0].argument))
        ) {
          // console.log('fdgfygdugyuyu')
          // console.log(node.left.property.value)
          const proxyFnIdentifier = node.left.object.name;
          const proxyFnBinding = path.scope.getBinding(proxyFnIdentifier);

          const key = `${node.left.object.name}_${node.left.property.value}`;

          // keyToBinding.set(key, proxyFnBinding);

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

          proxyFnBinding.referencePaths.forEach((refPath) => {
            if (
              t.isAssignmentExpression(refPath.parentPath.node) &&
              t.isIdentifier(refPath.parentPath.node.left)
            ) {
              const refBinding = refPath.scope.getBinding(
                refPath.parentPath.node.left.name
              );
              const key = `${refPath.parentPath.node.left.name}_${node.left.property.value}`;
              // if (bindingToKey.has(refBinding)) return;
              // keyToBinding.set(key, refBinding);
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
        if (!bindingScopeId) return;

        if (!scopeIdToBinaryOpPath[bindingScopeId]) return;

        const bindingPropName =
          node.callee.property.value || node.callee.property.name;
        const key = `${bindingName}_${bindingPropName}`;

        // console.log(scopeIdToBinaryOpPath[bindingScopeId].get(key));

        const binaryOpPath = scopeIdToBinaryOpPath[bindingScopeId].get(key);

        if (t.isBinaryExpression(binaryOpPath)) {
          path.replaceWith(
            t.binaryExpression(
              binaryOpPath.operator,
              node.arguments[0],
              node.arguments[1]
            )
          );
        }
      },
    });
  }

  _simplifyProxyFunctionsCalls() {}

  _test() {
    traverse(this._ast, {
      MemberExpression: (path) => {
        if (path.node.property.name === 'CAVHW') {
          // console.log(path.scope.getBinding('n').scope.uid);
          // console.log(Object.getOwnPropertyNames(path.scope.getBinding('m')));

          // const binding = path.scope.getBinding('m');

          // binding.referencePaths.forEach((refPath) => {
          //   if (t.isAssignmentExpression(refPath.parentPath.node))
          //     console.log(refPath.parentPath.node);
          // });
          path.stop();
        }
      },
    });
  }
}

module.exports = Deobfuscator;
