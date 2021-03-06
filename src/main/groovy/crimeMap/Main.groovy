package crimeMap

import groovy.transform.CompileStatic

import java.time.LocalDate

@CompileStatic
class Main {
  static void main(String[] args) {
    initProxy()
    IncidentLoader.updateThroughYesterday()
  }

  static void initProxy() {
    System.properties.putAll([
        socksProxyHost: 'localhost',
        socksProxyPort: '9150'
    ])
  }
}
