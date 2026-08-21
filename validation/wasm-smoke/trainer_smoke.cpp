#include <emscripten/emscripten.h>

#include <string>

namespace
{
std::string response;
}

extern "C" EMSCRIPTEN_KEEPALIVE const char* trainer_smoke( const char* talent_code, int targets )
{
  const std::string talent = talent_code ? talent_code : "";
  response = "{\"accepted\":" + std::string( talent.empty() ? "false" : "true" ) +
             ",\"targets\":" + std::to_string( targets ) +
             ",\"talentLength\":" + std::to_string( talent.size() ) + "}";
  return response.c_str();
}
