package crimeMap

import groovy.transform.CompileStatic

import java.time.LocalDate

@CompileStatic
class Main {
  static void main(String[] args) {
    initProxy()
    Util.pprintln ApdAdapter.getIncidentsForDate(LocalDate.parse('2015-05-02'))
  }

  static void initProxy() {
    System.properties.putAll([
        socksProxyHost: 'localhost',
        socksProxyPort: '9150'
    ])
  }
}
