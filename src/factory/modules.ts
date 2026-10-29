// Loads every module, including the cross-module hooks (e.g. QMS rules on lot status).
// Imported by the API wrapper, the worker and the tests so the same rules apply everywhere.
import "./permissions";
import "./qms/lotQuality";
import "./qms/ncr";
