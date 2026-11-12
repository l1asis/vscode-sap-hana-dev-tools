$.import("acme.com.app1.lib", "helpers");
var conn = $.hdb.getConnection();
var rs = conn.executeQuery("SELECT * FROM DUMMY");
$.response.status = $.net.http.OK;
$.response.contentType = "application/json";
$.response.setBody(JSON.stringify({ user: $.session.getUsername(), mail: $.net.Mail.Part.TYPE_TEXT }));
