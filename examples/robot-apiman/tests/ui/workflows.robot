*** Settings ***
Documentation     ApiMan used the way a person uses it: send requests and read the answers, variables and environments,
...               cURL import, generated code, saving to a collection, tests in scripts, errors in plain words, and the
...               data folder updating the app by itself. The requests go to a small local web server this suite starts
...               (Python's http.server on the testdata/ folder), never to the internet.
Library           Browser
Library           Process
Resource          ../../resources/apiman.resource
Suite Setup       Open ApiMan With A Target
Suite Teardown    Run Keywords    Close Browser    ALL    AND    Stop ApiMan Under Test
Test Setup        Start From A New Request
Test Tags         ui    workflows

*** Variables ***
${TARGET}         ${EMPTY}    # set in Suite Setup: the local web server the requests go to

*** Keywords ***
Open ApiMan With A Target
    Open ApiMan Session
    Reset Workspace
    ${port}=    Evaluate    urllib.parse.urlparse($BASE_URL).port + 1    modules=urllib.parse
    Start Process    ${{sys.executable}}    -m    http.server    ${port}    --bind    127.0.0.1    --directory    ${CURDIR}/../../testdata
    ...    alias=target
    Set Suite Variable    ${TARGET}    http://127.0.0.1:${port}
    Wait Until Keyword Succeeds    40x    0.25s    GET    ${TARGET}/environments.json    timeout=1
    ${is_headless}=    Get Variable Value    ${HEADLESS}    ${True}
    New Browser    chromium    headless=${is_headless}
    New Context    viewport={'width': 1440, 'height': 900}
    New Page    ${BASE_URL}
    Wait For Elements State    css=[data-act="new-request"]    visible

Start From A New Request
    [Documentation]    A fresh, unsaved request tab in front, whatever the last test left open.
    Keyboard Key    press    Escape
    Click    id=btnNew
    Click    css=#popover .mi >> text="Request"
    Wait For Elements State    id=url    visible

Send To
    [Arguments]    ${url}
    Fill Text    id=url    ${url}
    Click    id=btnSend
    Wait For Condition    Element States    id=btnSend    not contains    busy    timeout=15s

Response Status Should Be
    [Arguments]    ${code}
    Wait For Elements State    css=#respStatus .status-code    visible    timeout=15s
    Get Text    css=#respStatus .status-code    matches    ^${code}\\b    # "200 OK"

Set Script
    [Documentation]    Types a script into the Scripts tab (pre or test), as a person pasting it would.
    [Arguments]    ${kind}    ${code}
    Click    id=tab-scripts
    Click    css=[data-script="${kind}"]
    Click    css=#scriptEditor .CodeMirror
    Keyboard Input    insertText    ${code}

Create Environment
    [Arguments]    ${name}    &{values}
    Select Options By    id=envSelect    value    __new
    Wait For Elements State    css=dialog[open]    visible
    Fill Text    css=#dlgBody input >> nth=0    ${name}
    ${i}=    Set Variable    ${0}
    FOR    ${key}    ${value}    IN    &{values}
        Fill Text    css=#dlgBody table.kv tr[data-i="${i}"] [data-col="key"]    ${key}
        Fill Text    css=#dlgBody table.kv tr[data-i="${i}"] [data-col="value"]    ${value}
        ${i}=    Evaluate    ${i} + 1
    END
    Click    css=#dlgFoot .btn.primary
    Wait For Elements State    css=dialog[open]    detached
    Get Selected Options    id=envSelect    label    ==    ${name}

*** Test Cases ***
Send A GET And Read The JSON Answer
    [Tags]    smoke
    Send To    ${TARGET}/environments.json
    Response Status Should Be    200
    Get Text    id=respBody    contains    Robot Staging
    Get Text    id=respStatus    matches    \\d+ ms

Response Headers Are Listed
    Send To    ${TARGET}/environments.json
    Response Status Should Be    200
    Click    id=tab-rheaders
    Get Text    id=respHeaders    contains    Content-Length
    Get Text    id=cntRHeaders    matches    \\d+

A Missing Page Answers 404
    Send To    ${TARGET}/does-not-exist.json
    Response Status Should Be    404

The Keyboard Shortcut Sends
    Fill Text    id=url    ${TARGET}/create-collection.json
    Keyboard Key    press    Control+Enter
    Response Status Should Be    200
    Get Text    id=respBody    contains    info

Query Parameters Follow The URL
    Fill Text    id=url    ${TARGET}/environments.json?page=2&size=10
    Click    id=tab-params
    ${keys}=    Evaluate JavaScript    ${None}    [...document.querySelectorAll('#paramsKv [data-col="key"]')].map((i) => i.value).filter(Boolean)
    Should Be Equal As Strings    ${keys}    ['page', 'size']
    Get Text    id=cntParams    ==    2

An Unknown Variable Is Explained
    Fill Text    id=url    {{nowhere}}/x
    Get Text    id=resolved    contains    Resolves to
    Click    id=btnSend
    Wait For Elements State    css=#respBody .note    visible    timeout=10s
    Get Text    id=respBody    contains    Unknown variable {{nowhere}}

Environment Variables Resolve In The URL
    Create Environment    Robot target    host=${TARGET}    file=environments.json
    Fill Text    id=url    {{host}}/{{file}}
    Get Text    id=resolved    ==    Resolves to ${TARGET}/environments.json
    Click    id=btnSend
    Response Status Should Be    200

A Variable That Refers To Itself Is Named
    Create Environment    Robot loop    loop={{loop}}x
    Fill Text    id=url    ${TARGET}/{{loop}}
    Click    id=btnSend
    Wait For Elements State    css=#respBody .note    visible    timeout=10s
    Get Text    id=respBody    contains    refers to itself

Duplicate Environment Keys Are Pointed Out
    Select Options By    id=envSelect    value    __new
    Wait For Elements State    css=dialog[open]    visible
    Fill Text    css=#dlgBody table.kv tr[data-i="0"] [data-col="key"]    host
    Fill Text    css=#dlgBody table.kv tr[data-i="1"] [data-col="key"]    host
    Get Text    css=#dlgBody .note    contains    only the last one is used
    Click    css=#dlgFoot .btn >> text=Cancel
    Wait For Elements State    css=dialog[open]    detached

A Passing Test Script Shows In Tests
    Set Script    test    pm.test("Status is 200", () => pm.response.to.have.status(200));\npm.test("Lists the staging environment", () => pm.expect(pm.response.text()).to.include("Robot Staging"));
    Send To    ${TARGET}/environments.json
    Response Status Should Be    200
    Click    id=tab-rtests
    Get Text    id=respTests    contains    Status is 200
    Get Text    id=respTests    contains    Lists the staging environment
    Get Element Count    css=#respTests .test-row .pill.err    ==    0

A Failing Test Script Is Reported
    Set Script    test    pm.test("Expects a 404", () => pm.response.to.have.status(404));
    Send To    ${TARGET}/environments.json
    Wait For Elements State    css=#respTests .pill.err    visible    timeout=10s
    Get Text    id=respTests    contains    Expects a 404

Scripts Can Log To The Console
    Set Script    pre    console.log("hello from the pre-request script");
    Send To    ${TARGET}/environments.json
    Response Status Should Be    200
    Click    id=tab-rconsole
    Get Text    id=respConsole    contains    hello from the pre-request script

A cURL Command Becomes A Request
    Click    id=btnImport
    Wait For Elements State    css=dialog[open]    visible
    Click    css=#dlgBody .seg-btn >> text=cURL
    Fill Text    css=#dlgBody textarea[aria-label="cURL command"]    curl -X POST '${TARGET}/create-collection.json?from=curl' -H 'X-Trace: robot' --data-raw '{"a":1}'
    Click    css=#dlgFoot .btn.primary
    Wait For Elements State    css=dialog[open]    detached
    Get Selected Options    id=method    value    ==    POST
    Get Property    id=url    value    contains    from=curl
    Get Text    id=cntHeaders    ==    1

Generated Code Matches The Request
    Fill Text    id=url    ${TARGET}/environments.json?id=1
    Click    id=btnCode
    Wait For Elements State    css=dialog[open]    visible
    ${code}=    Evaluate JavaScript    ${None}    document.querySelector('#dlgBody .CodeMirror').CodeMirror.getValue()
    Should Contain    ${code}    curl
    Should Contain    ${code}    ${TARGET}/environments.json?id=1
    Click    css=#dlgBody .seg-btn >> text=Python
    ${python}=    Evaluate JavaScript    ${None}    document.querySelector('#dlgBody .CodeMirror').CodeMirror.getValue()
    Should Contain    ${python}    requests
    Click    css=#dlgFoot .btn >> text=Close
    Wait For Elements State    css=dialog[open]    detached

Save A Request Into A Collection
    ${collection}=    Load Test Data    create-collection.json    collection
    Set To Dictionary    ${collection}[info]    name=Robot UI saves
    ${cid}=    Create Collection    ${collection}
    Reload
    Start From A New Request
    Fill Text    id=url    ${TARGET}/environments.json
    Fill Text    id=reqName    Environments file
    Click    id=btnSave
    Wait For Elements State    css=dialog[open]    visible
    Select Options By    css=#dlgBody select    label    Robot UI saves
    Click    css=#dlgFoot .btn.primary
    Wait For Elements State    css=dialog[open]    detached
    Wait For Elements State    css=#side >> text=Environments file    visible    timeout=5s
    [Teardown]    Delete Collection    ${cid}

Sent Requests Are In History
    Send To    ${TARGET}/environments.json?from=history
    Response Status Should Be    200
    Click    css=#side .seg-btn >> text=History
    Wait For Elements State    css=#sideBody >> text=/from=history/    visible    timeout=5s
    Click    css=#side .seg-btn >> text=Collections

A File Dropped Into The Data Folder Shows Up By Itself
    [Documentation]    No reload: ApiMan notices the new file and lists it (git pull, a synced team folder, an editor).
    ${info}=    GET On Session    apiman    /api/info
    ${name}=    Set Variable    Dropped in by Robot
    Create File    ${info.json()}[dataDir]/dropped-by-robot.json
    ...    {"info": {"name": "${name}", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"}, "item": []}
    Wait For Elements State    css=#side >> text=${name}    visible    timeout=15s
    [Teardown]    Remove File    ${info.json()}[dataDir]/dropped-by-robot.json
