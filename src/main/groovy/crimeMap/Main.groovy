package crimeMap
class Main {
  static void main(String[] args) {
    initProxy()
    println ApdAdapter.getIncidentsForDay('05/02/2015').size()
  }
  static void initProxy() {
    System.properties.putAll([
        socksProxyHost: 'localhost',
        socksProxyPort: '9150'
    ])
  }
}
