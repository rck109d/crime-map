package crimeMap

import groovy.json.JsonSlurper

class Util {
  static Object parseJson(String json) {
    return new JsonSlurper().parseText(json)
  }

  static String dashyYMD2slashyMDY(String dashyYMD) {
    "${dashyYMD[5..6]}/${dashyYMD[8..9]}/${dashyYMD[0..3]}"
  }
}
