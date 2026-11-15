// Format Document in VS Code delegates `.xsjs` to VS Code's JS formatter while keeping pragmas verbatim
$.import("demo.app.lib","helpers");

function handleGet(req){
var conn=$.hdb.getConnection();
var rs=conn.executeQuery("SELECT ORDER_ID, AMOUNT FROM DEMO_ORDERS WHERE STATUS = ?",req.status||"OPEN");
// hanasql-format off
var   unformattedMatrix  =  [  1,   2,   3  ];
// hanasql-format on
$.response.status=$.net.http.OK;
$.response.contentType="application/json";
$.response.setBody(JSON.stringify({rows:rs,matrix:unformattedMatrix}));
}
