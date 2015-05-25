package crimeMap

class Main {
  static void main(String[] args) {
    initProxy()
    println ApdAdapter.getIncidentsForDate('2015-05-02').size()
  }

  static void initProxy() {
    System.properties.putAll([
        socksProxyHost: 'localhost',
        socksProxyPort: '9150'
    ])
  }
}
