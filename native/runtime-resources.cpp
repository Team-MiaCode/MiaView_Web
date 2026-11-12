#include <QResource>
#include <emscripten/emscripten.h>

// Qt reads directly from this allocation for the lifetime of the module.
extern "C" EMSCRIPTEN_KEEPALIVE int miacode_register_resource(const unsigned char* data)
{
    return QResource::registerResource(data);
}
