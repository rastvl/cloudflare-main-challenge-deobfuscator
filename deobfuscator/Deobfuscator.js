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
  console_log(
    '==========================================================================================================================',
    counter
  );
  console_log.apply(this, arguments);
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
    path.scope.traverse(
      path.scope.block,
      {
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
      }
    );
  }

  _replaceInnerString() {
    const scopeIdToArray = new Map();
    const a = performance.now();

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
              return this.array[index + this.arrayIndexOffset]
            }
          };

          // Need to find the string and the delimiter.
          // All this is in the scope along with bindingAssignmentPath
          // bindingAssignmentPath.scope.traverse(
          //   bindingAssignmentPath.scope.block,
          //   {
          //     CallExpression: (path_) => {
          //       const node_ = path_.node;
          //       if (
          //         node_.callee &&
          //         t.isMemberExpression(node_.callee) &&
          //         !node_.callee.computed &&
          //         t.isStringLiteral(node_.callee.object) &&
          //         t.isIdentifier(node_.callee.property) &&
          //         node_.callee.property.name === 'split'
          //       ) {
          //         const delimiter = node_.arguments[0].value;
          //         scopeData.array = node_.callee.object.value.split(delimiter);
          //         path_.stop();
          //       }
          //     },
          //   }
          // );
          this._getInnerArray(bindingAssignmentPath, scopeData);

          // We need to shuffle our array
          // To do this we need to find the shuffle index
          let shuffleIndex;
          bindingAssignmentPath.scope.traverse(
            bindingAssignmentPath.scope.block,
            {
              CallExpression: (path_) => {
                const node_ = path_.node;

                if (
                  node_.arguments.length ===
                    SHUFFLE_ARRAY_FUNCTION_ARGS_LENGTH &&
                  t.isNumericLiteral(node_.arguments[1]) &&
                  t.isIdentifier(node_.arguments[0]) &&
                  node_.arguments[0].name === arrayIdentifierName
                ) {
                  shuffleIndex = node_.arguments[1].value + 1;

                  // ShuffleArray
                  for (
                    ;
                    --shuffleIndex;
                    scopeData.array.push(scopeData.array.shift())
                  );
                }
              },
            }
          );

          // console.log(scopeData.array);
          scopeIdToArray.set(path.scope.uid, scopeData);
          path.replaceWith(
            t.stringLiteral(
              scopeData.getString(parseInt(node.arguments[0].value, 16))
            )
          );
          // path.stop();
        }
      },
    });
    console.log(performance.now() - a);
  }
}

module.exports = Deobfuscator;
