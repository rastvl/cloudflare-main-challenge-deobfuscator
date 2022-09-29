# cloudflare-main-challenge-deobfuscator
A series of ast-manipulations to create more readable cloudflare script code.

## Features
1) Conversion of all strings:
from:
```js
return g[b(_[72])][b(_[10])][b(_[74])][b(_[119])](h)===b(_[137])
```
to:
```js
return g.Object.prototype.toString.call(h) === "[object Array]";
```

2) Simplifying the function call:
from:
```js
var m['foo'] = function (a,b) {
  return a + b;
},
n = m;

return n['foo'](a,b);
```
to:
```js
var m['foo'] = function (a,b) {
  return a + b;
},
n = m;

return a + b;
```
3) Simplifying the object props access:
from:
```js
var e['foo'] = '300',
g = e;

F.width = g['foo']
```

to:
```js
var e['foo'] = '300',
g = e;

F.width = '300'
```

4) Simplifying logical branches:
from:
```js
if ('foo' === 'foo') {
  return bar;
}
```
to:
```js
return bar;
```

5) Main control flow flattening conversion


## usage
```
git clone https://github.com/rastvl/cloudflare-main-challenge-deobfuscator.git
cd cloudflare-main-challenge-deobfuscator
npm install
```
Paste the main challenge script into `input/cf-main-challenge.js` and then:
```
npm run start
```