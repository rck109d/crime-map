package crimeMap

import groovy.json.JsonOutput
import org.apache.http.HttpEntity
import org.apache.http.HttpResponse
import org.apache.http.client.HttpClient
import org.apache.http.client.methods.HttpPost
import org.apache.http.config.Registry
import org.apache.http.config.RegistryBuilder
import org.apache.http.conn.socket.ConnectionSocketFactory
import org.apache.http.entity.StringEntity
import org.apache.http.impl.client.HttpClients
import org.apache.http.impl.conn.PoolingHttpClientConnectionManager
import org.apache.http.message.BasicHeader
import org.apache.http.protocol.HTTP
import org.apache.http.util.EntityUtils

class ApdAdapter {
  private static final String crimeDataUri = 'http://65.82.136.65:80/Service.aspx/GetMapData'
  private static final HttpClient httpClient = createHttpClient()

  private static HttpClient createHttpClient() {
    RegistryBuilder registryBuilder = RegistryBuilder.<ConnectionSocketFactory> create()
    registryBuilder.register('http', new TorSocketFactory())
    Registry<ConnectionSocketFactory> socketFactoryRegistry = registryBuilder.build()
    PoolingHttpClientConnectionManager connectionManager = new PoolingHttpClientConnectionManager(socketFactoryRegistry)
    HttpClient httpClient = HttpClients.custom().setConnectionManager(connectionManager).build()
    return httpClient
  }

  /**
   *
   * @param ymd yyyy-MM-dd
   * @return incidents for all zones on date
   */
  static List getIncidentsForDate(String ymd) {
    (1..6).collectMany { int zone ->
      getIncidentsForZoneAndDate(zone, ymd)
    }
  }

  /**
   *
   * @param zone 1-6
   * @param ymd yyyy-MM-dd
   * @return incidents for zone on date
   */
  private static List getIncidentsForZoneAndDate(int zone, String ymd) {
    String zoneId = (String) zone
    String offenseCodes = (1..8).join(',')
    String startDate = ymd
    String endDate = ymd
    String response = fetchCrimeData(zoneId, offenseCodes, startDate, endDate)
    Map responseMap = Util.parseJson(response)
    // double-decode insanity
    responseMap = Util.parseJson((String) responseMap.d)
    int recordCount = Integer.parseInt((String) responseMap.recordCount, 10)
    List incidents = responseMap.incidents
    assert incidents.size() == recordCount
    return incidents
  }

  /**
   *
   * @param zoneId 1-6
   * @param offenseCodes 1,2,3,4,5,6,7,8
   * @param start yyyy-MM-dd
   * @param end yyyy-MM-dd
   * @return response as string
   */
  private static String fetchCrimeData(String zoneID, String offenseCodes, String start, String end) {
    // APD server wants MM/dd/yyyy
    String startMDY = Util.dashyYMD2slashyMDY(start)
    String endMDY = Util.dashyYMD2slashyMDY(end)
    String json = JsonOutput.toJson([
        zoneID      : zoneID,
        offenseCodes: offenseCodes,
        startDate   : startMDY,
        endDate     : endMDY
    ])
    final StringEntity se = new StringEntity(json)
    se.setContentType(new BasicHeader(HTTP.CONTENT_TYPE, 'application/json'))
    String responseString = post(crimeDataUri, se)
    return responseString
  }

  /**
   *
   * @param uri remote address
   * @param entity post body
   * @return response as string
   */
  private static String post(String uri, HttpEntity entity) {
    final HttpPost httpPost = new HttpPost(uri)
    httpPost.setEntity(entity)
    final HttpResponse response = httpClient.execute(httpPost)
    final HttpEntity responseEntity = response.getEntity()
    final String responseString = EntityUtils.toString(responseEntity)
    return responseString
  }
}
