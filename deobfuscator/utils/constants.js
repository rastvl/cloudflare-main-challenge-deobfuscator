const MAIN_ARRAY_NAME = '_';
const SHUFFLE_ARRAY_FUNCTION_ARGS_LENGTH = 2;
const MAIN_FOR_STATEMENT_TEST = 'life goes on';

// path types(for control flow flattening)
const chl_done_ref = Symbol('chl_done_ref'); // Function with the parameter chl_done, and it is used
const chl_done_no_ref = Symbol('chl_done_no_ref');
const no_chl_done = Symbol('no_chl_done'); // No function, just statements

module.exports = {
  MAIN_ARRAY_NAME,
  SHUFFLE_ARRAY_FUNCTION_ARGS_LENGTH,
  MAIN_FOR_STATEMENT_TEST,
  chl_done_ref,
  chl_done_no_ref,
  no_chl_done
}