// HANA-MIG-020: XS Classic APIs without an XS Advanced equivalent.
var session = $.repo.createActiveSession();
if ($.session.hasSystemPrivilege("USER ADMIN")) {
  session.close();
}
