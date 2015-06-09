package crimeMap

class Main {
  static void main(String[] args) {
    initProxy()
    Util.pprintln ApdAdapter.getIncidentsForDate('2015-05-02')
  }

  static void initProxy() {
    System.properties.putAll([
        socksProxyHost: 'localhost',
        socksProxyPort: '9150'
    ])
  }
}
