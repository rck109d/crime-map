package crimeMap

import groovy.json.JsonOutput
import org.apache.http.HttpEntity
import org.apache.http.HttpResponse
import org.apache.http.client.HttpClient
import org.apache.http.client.methods.HttpGet
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

  private static final PoolingHttpClientConnectionManager phccm
  private static final HttpClient                         httpClient
  private static final String crimeDataUri = "http://65.82.136.65:80/Service.aspx/GetMapData"

  static {
    Registry<ConnectionSocketFactory> socketFactoryRegistry = RegistryBuilder.<ConnectionSocketFactory> create().register("http", new TorSocketFactory()).build()
    phccm = new PoolingHttpClientConnectionManager(socketFactoryRegistry)
    httpClient = HttpClients.custom().setConnectionManager(phccm).build()
  }

  /**
   *
   * @param mdySlashy MM/dd/yyyy
   * @return incidents for all zones on day
   */
  static List getIncidentsForDay(String mdySlashy) {
   (1..6).collectMany { int zone ->
      getIncidentsForZoneAndDay(zone, mdySlashy)
    }
  }

  /**
   *
   * @param zone 1-6
   * @param mdySlashy MM/dd/yyyy
   * @return incidents for zone on day
   */
  private static List getIncidentsForZoneAndDay(int zone, String mdySlashy) {
    String zoneId = (String)zone
    String offenseCodes = (1..8).join(',')
    String startDate = mdySlashy
    String endDate = mdySlashy
    String response = fetchCrimeData(zoneId, offenseCodes, startDate, endDate)
    Map responseMap = Util.parseJson(response)
    // double-decode insanity
    responseMap = Util.parseJson((String)responseMap.d)
    int recordCount = Integer.parseInt((String)responseMap.recordCount, 10)
    List incidents = responseMap.incidents
    assert incidents.size() == recordCount
    return incidents
  }

  /**
   *
   * @param zoneId 1-6
   * @param offenseCodes 1,2,3,4,5,6,7,8
   * @param startDate MM/dd/yyyy
   * @param endDate MM/dd/yyyy
   * @return response as string
   */
  private static String fetchCrimeData(String zoneID, String offenseCodes, String startDate, String endDate) {
    String json = JsonOutput.toJson([
      zoneID: zoneID,
      offenseCodes: offenseCodes,
      startDate: startDate,
      endDate: endDate
    ])
    final StringEntity se = new StringEntity(json)
    se.setContentType(new BasicHeader(HTTP.CONTENT_TYPE, "application/json"))
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

  /**
   * echo the apparent IP address to examine anonymity
   */
  @SuppressWarnings("GroovyUnusedDeclaration")
  static void echoIp() {
    final HttpGet httpGet = new HttpGet('http://ipecho.net/plain')
    final HttpResponse response = httpClient.execute(httpGet)
    final HttpEntity responseEntity = response.getEntity()
    final String responseString = EntityUtils.toString(responseEntity)
    println responseString
  }
}
