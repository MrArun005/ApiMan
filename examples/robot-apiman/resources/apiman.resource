*** Settings ***
Documentation     Shared keywords for talking to the ApiMan under test.
Library           RequestsLibrary
Library           Collections
Library           String
Library           OperatingSystem
Library           Process

*** Variables ***
${TOKEN_HEADER}    X-ApiMan-Token

*** Keywords ***
Start ApiMan Under Test
    [Documentation]    The tests run against a second ApiMan with a throwaway data folder, never your real collections.
    ...    It's started here (from APIMAN_SERVER, the path to ApiMan's server.py) unless one already answers at BASE_URL.
    ${up}=    Run Keyword And Return Status    GET    ${BASE_URL}/    timeout=2
    IF    ${up}    RETURN
    ${server}=    Get Variable Value    ${APIMAN_SERVER}    ${EMPTY}
    Should Not Be Empty    ${server}
    ...    msg=Nothing answers at ${BASE_URL}. Set APIMAN_SERVER (the path to ApiMan's server.py) in the environment, or start an ApiMan there.
    ${port}=    Evaluate    urllib.parse.urlparse($BASE_URL).port    modules=urllib.parse
    ${data}=    Evaluate    tempfile.mkdtemp(prefix="apiman-under-test-")    modules=tempfile
    Start Process    ${{sys.executable}}    ${server}    --port    ${port}    --no-browser    --data    ${data}    alias=apiman-under-test
    Wait Until Keyword Succeeds    40x    0.25s    GET    ${BASE_URL}/    timeout=1

Stop ApiMan Under Test
    Terminate All Processes

Open ApiMan Session
    [Documentation]    ApiMan's API needs the per-launch token it writes into its own page.
    Start ApiMan Under Test
    ${page}=    GET    ${BASE_URL}/    expected_status=200
    ${token}=    Get Regexp Matches    ${page.text}    name="apiman-token" content="([^"]+)"    1
    Should Not Be Empty    ${token}    msg=No session token in the ApiMan page at ${BASE_URL}
    &{headers}=    Create Dictionary    ${TOKEN_HEADER}=${token}[0]
    Create Session    apiman    ${BASE_URL}    headers=${headers}

Load Test Data
    [Documentation]    A JSON file from testdata/, or one key of it.
    [Arguments]    ${name}    ${key}=${NONE}
    ${text}=    Get File    ${CURDIR}/../testdata/${name}
    ${data}=    Evaluate    json.loads($text)    json
    IF    $key is not None    RETURN    ${data}[${key}]
    RETURN    ${data}

Create Collection
    [Arguments]    ${collection}
    ${body}=    Create Dictionary    collection=${collection}
    ${r}=    POST On Session    apiman    /api/collections    json=${body}    expected_status=201
    RETURN    ${r.json()}[id]

Delete Collection
    [Arguments]    ${id}
    DELETE On Session    apiman    /api/collections/${id}    expected_status=200

Reset Workspace
    [Documentation]    Open tabs and history are kept in the data folder: start every UI run from a clean screen.
    ${empty}=    Create Dictionary
    PUT On Session    apiman    /api/state    json=${empty}    expected_status=200
