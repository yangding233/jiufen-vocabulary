'use strict';
// Standard npm dependency; an explicit module override can be used by CI.
module.exports=require(process.env.JIUFEN_PLAYWRIGHT_MODULE||'playwright');
