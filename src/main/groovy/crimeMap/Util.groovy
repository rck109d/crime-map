package crimeMap

import groovy.json.JsonSlurper

class Util {
  static Object parseJson(String json) {
    return new JsonSlurper().parseText(json)
  }
}
