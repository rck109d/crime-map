package crimeMap

import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import groovy.transform.CompileStatic

import java.time.LocalDate

@CompileStatic
class Util {
    static Object parseJson(String json) {
        return new JsonSlurper().parseText(json)
    }

    static String slashyMDY2dashedYMD(String slashyMDY) {
        "${slashyMDY[6..9]}-${slashyMDY[0..1]}-${slashyMDY[3..4]}"
    }

    static String localDate2slashyMDY(LocalDate localDate) {
        String dashyYMD = localDate.toString()
        "${dashyYMD[5..6]}/${dashyYMD[8..9]}/${dashyYMD[0..3]}"
    }

    static void pprintln(x) {
        println JsonOutput.prettyPrint(JsonOutput.toJson(x))
    }
}
