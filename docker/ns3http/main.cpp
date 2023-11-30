#include <ns3/applications-module.h>
#include <ns3/core-module.h>
#include <ns3/fd-net-device-module.h>
#include <ns3/internet-module.h>

int
main(int argc, char* argv[]) {
  ns3::GlobalValue::Bind("SimulatorImplementationType",
                         ns3::StringValue("ns3::RealtimeSimulatorImpl"));
  ns3::GlobalValue::Bind("ChecksumEnabled", ns3::BooleanValue(true));

  std::string tapIfname;
  auto tapIP = ns3::Ipv4Address::GetAny();
  ns3::Ipv4Mask tapMask;
  auto appIP = ns3::Ipv4Address::GetAny();
  bool isServer = false;
  auto connectTo = ns3::Ipv4Address::GetAny();
  int nClients = 1;
  ns3::CommandLine cmd;
  cmd.AddValue("tap-if", "TAP device name", tapIfname);
  cmd.AddValue("tap-ip", "TAP IPv4 address", tapIP);
  cmd.AddValue("tap-mask", "TAP IPv4 subnet mask", tapMask);
  cmd.AddValue("app-ip", "application IPv4 address", appIP);
  cmd.AddValue("listen", "run as server", isServer);
  cmd.AddValue("connect", "run as client and connect to server IPv4 address", connectTo);
  cmd.AddValue("clients", "number of clients (1-1000)", nClients);
  cmd.Parse(argc, argv);
  NS_ASSERT_MSG(isServer != (!connectTo.IsAny()), "server-mode || client-mode");
  NS_ASSERT_MSG(nClients >= 1, "clients >= 1");

  auto node = ns3::CreateObject<ns3::Node>();
  ns3::InternetStackHelper inetHelper;
  ns3::Ipv4StaticRoutingHelper routingHelper;
  inetHelper.SetRoutingHelper(routingHelper);
  inetHelper.Install(node);

  ns3::TapFdNetDeviceHelper tapHelper;
  tapHelper.SetDeviceName(tapIfname);
  tapHelper.SetTapIpv4Address(tapIP);
  tapHelper.SetTapIpv4Mask(tapMask);
  auto emuDevice = tapHelper.Install(node).Get(0);

  auto ipv4 = node->GetObject<ns3::Ipv4>();
  auto intf = ipv4->AddInterface(emuDevice);
  ipv4->AddAddress(intf, ns3::Ipv4InterfaceAddress(appIP, tapMask));
  ipv4->SetMetric(intf, 1);
  ipv4->SetUp(intf);
  routingHelper.GetStaticRouting(ipv4)->AddNetworkRouteTo(ns3::Ipv4Address::GetAny(),
                                                          ns3::Ipv4Mask::GetZero(), tapIP, intf);

  if (isServer) {
    ns3::ThreeGppHttpServerHelper serverHelper(appIP);
    serverHelper.Install(node);
  } else {
    ns3::ThreeGppHttpClientHelper clientHelper(connectTo);
    for (int i = 0; i < nClients; ++i) {
      clientHelper.Install(node);
    }
  }

  ns3::Simulator::Run();
}
