var region = $.request.parameters.get("region");
// HANA-SEC-011: legacy $.db connection.
var legacy = $.db.getConnection();
// HANA-SEC-010: concatenated SQL.
var rs = $.hdb.getConnection().executeQuery("SELECT ORDER_ID FROM ORDERS WHERE REGION = '" + region + "'");
// HANA-SEC-012: reflected request input.
$.response.setBody("<p>" + $.request.parameters.get("note") + "</p>");
