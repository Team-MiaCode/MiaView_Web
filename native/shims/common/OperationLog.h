#pragma once
#include <QString>
// Desktop breadcrumb persistence is intentionally absent in the browser host.
namespace miacode::oplog {
struct Scope {
    template<class... Args> explicit Scope(Args&&...) {}
    void note(const QString&) {}
    void fail(const QString&) {}
};
}
#define MC_OP(name) ::miacode::oplog::Scope _mc_op_(name)
